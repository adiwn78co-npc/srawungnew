// server.ts
import express from "express";
import { createServer as createViteServer } from "vite";
import fs3 from "fs";
import path3 from "path";
import crypto from "crypto";
import { fileURLToPath as fileURLToPath2 } from "url";

// src/server/db.ts
import fs2 from "fs";
import path2 from "path";

// src/server/mysqlPool.ts
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
var __poolFile = fileURLToPath(import.meta.url);
var __poolDir = path.dirname(__poolFile);
for (const envCandidate of [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), ".env.production"),
  path.resolve(process.cwd(), ".env.local"),
  path.resolve(__poolDir, ".env"),
  path.resolve(__poolDir, "..", "..", ".env"),
  path.resolve(__poolDir, "..", "..", ".env.production")
]) {
  if (fs.existsSync(envCandidate)) {
    dotenv.config({ path: envCandidate, override: false });
  }
}
var cachedPool = null;
var cachedPoolHostOverride = null;
var loggedCloudRunLoopbackNotice = false;
function isCloudRunEnvironment() {
  return Boolean(process.env.K_SERVICE || process.env.CLOUD_RUN_JOB);
}
function isProductionHostingerEnvironment() {
  if (isCloudRunEnvironment()) {
    return false;
  }
  return process.env.NODE_ENV === "production" || Boolean(process.env.IN_PASSENGER) || Boolean(process.env.PASSENGER_APP_ENV) || Boolean(process.env.MYSQL_HOST || process.env.MYSQL_DATABASE || process.env.MYSQL_USER);
}
function isLoopbackMysqlHost(rawHost) {
  const host = String(rawHost || "").trim().toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host === "0.0.0.0";
}
function isPlaceholderValue(val) {
  const clean = val.trim().toLowerCase();
  return !clean || clean === "your_mysql_user" || clean === "your_mysql_database" || clean === "your_mysql_password";
}
function resolveMysqlConfig() {
  const mysqlHost = String(process.env.MYSQL_HOST || "").trim();
  const mysqlUser = String(process.env.MYSQL_USER || "").trim();
  const mysqlName = String(process.env.MYSQL_DATABASE || "").trim();
  const rawPort = process.env.MYSQL_PORT || "3306";
  const port = Number(rawPort) > 0 ? Number(rawPort) : 3306;
  const rawPassword = process.env.MYSQL_PASSWORD ?? "";
  const password = isPlaceholderValue(String(rawPassword)) ? "" : String(rawPassword);
  const user = !isPlaceholderValue(mysqlUser) ? mysqlUser : "";
  const database = !isPlaceholderValue(mysqlName) ? mysqlName : "";
  let host = mysqlHost;
  if (!host && user && database && !isCloudRunEnvironment()) {
    host = "127.0.0.1";
  }
  const socketPath = String(process.env.MYSQL_SOCKET_PATH || "").trim() || void 0;
  return {
    host,
    port,
    user,
    password,
    database,
    socketPath
  };
}
function validateMysqlEnvConfiguration() {
  const cfg = resolveMysqlConfig();
  const missingVars = [];
  if (!cfg.host) missingVars.push("MYSQL_HOST");
  if (!cfg.user) missingVars.push("MYSQL_USER");
  if (!cfg.database) missingVars.push("MYSQL_DATABASE");
  if (missingVars.length > 0) {
    return {
      configured: false,
      missingVars,
      safeSummary: `unconfigured (missing: ${missingVars.join(", ")})`
    };
  }
  return {
    configured: true,
    missingVars: [],
    safeSummary: `host=${cfg.host}, port=${cfg.port}, database=${cfg.database}, user=${cfg.user}`
  };
}
function isMysqlConfigured() {
  const cfg = resolveMysqlConfig();
  if (!cfg.host || !cfg.user || !cfg.database) {
    return false;
  }
  if (isCloudRunEnvironment() && isLoopbackMysqlHost(cfg.host) && process.env.MYSQL_STRICT_REQUIRED !== "true") {
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
async function resetMysqlPool() {
  const existing = cachedPool;
  cachedPool = null;
  tableColumnsCache.clear();
  if (existing) {
    try {
      await existing.end();
    } catch {
    }
  }
}
async function getMysqlPool(hostOverride) {
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
  const modName = "mysql2/promise";
  const mysqlModule = await import(
    /* @vite-ignore */
    modName
  );
  const mysql = mysqlModule.default || mysqlModule;
  const poolConfig = {
    host: effectiveHost,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    connectTimeout: 1e4,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: "utf8mb4"
  };
  if (cfg.socketPath) {
    poolConfig.socketPath = cfg.socketPath;
  }
  cachedPoolHostOverride = effectiveHost;
  cachedPool = mysql.createPool(poolConfig);
  return cachedPool;
}
async function verifyAndGetMysqlPool() {
  const cfg = resolveMysqlConfig();
  let pool = await getMysqlPool();
  if (!pool) {
    throw new Error("MySQL connection pool is unavailable.");
  }
  try {
    await pool.query("SELECT 1");
    return pool;
  } catch (err) {
    const code = String(err?.code || "");
    if (cfg.host.toLowerCase() === "localhost" && cachedPoolHostOverride !== "127.0.0.1" && (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EHOSTUNREACH")) {
      await resetMysqlPool();
      pool = await getMysqlPool("127.0.0.1");
      if (pool) {
        await pool.query("SELECT 1");
        return pool;
      }
    }
    throw err;
  }
}
async function ensureMysqlSchema(pool) {
  const candidatePaths = [
    path.resolve(process.cwd(), "database", "schema.sql"),
    path.resolve(__poolDir, "database", "schema.sql"),
    path.resolve(__poolDir, "..", "..", "database", "schema.sql")
  ];
  const schemaPath = candidatePaths.find((p) => fs.existsSync(p));
  if (!schemaPath) {
    return;
  }
  const sqlContent = fs.readFileSync(schemaPath, "utf-8");
  const cleanedSql = sqlContent.replace(/^\s*--.*$/gm, "");
  const statements = cleanedSql.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
  for (const stmt of statements) {
    if (/^\s*(DROP|TRUNCATE|DELETE)\b/i.test(stmt)) {
      continue;
    }
    await pool.query(stmt);
  }
}
function truncStr(val, maxLen) {
  if (val === null || val === void 0 || val === "") return null;
  const s = String(val);
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}
function safeJsonParse(raw, fallback) {
  if (!raw) return fallback;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}
var DEFAULT_PERMS_BY_ROLE = {
  admin: { canManagePrograms: false, canCreateTor: false, canApproveTor: false, canManageUsers: true, canViewAllTors: true },
  director: { canManagePrograms: true, canCreateTor: true, canApproveTor: true, canManageUsers: false, canViewAllTors: true },
  hr: { canManagePrograms: false, canCreateTor: true, canApproveTor: false, canManageUsers: false, canViewAllTors: true },
  finance: { canManagePrograms: false, canCreateTor: true, canApproveTor: true, canManageUsers: false, canViewAllTors: true },
  program_manager: { canManagePrograms: true, canCreateTor: true, canApproveTor: true, canManageUsers: false, canViewAllTors: true },
  meal: { canManagePrograms: true, canCreateTor: true, canApproveTor: false, canManageUsers: false, canViewAllTors: true },
  staff: { canManagePrograms: false, canCreateTor: true, canApproveTor: false, canManageUsers: false, canViewAllTors: false }
};
function normalizeMysqlUserRole(rawRole) {
  const clean = String(rawRole || "").trim().toLowerCase();
  if (clean === "admin" || clean === "administrator" || clean === "system administrator" || clean === "superadmin") {
    return "admin";
  }
  if (clean === "director" || clean === "direktur" || clean === "executive director") {
    return "director";
  }
  if (clean === "finance" || clean === "keuangan" || clean === "finance & hr manager" || clean === "finance_hr") {
    return "finance";
  }
  if (clean === "hr" || clean === "hrd" || clean === "human resources") {
    return "hr";
  }
  if (clean === "program_manager" || clean === "program manager" || clean === "pm") {
    return "program_manager";
  }
  if (clean === "meal" || clean === "meal coordinator" || clean === "monitoring") {
    return "meal";
  }
  if (clean === "staff" || clean === "staf") {
    return "staff";
  }
  return clean || "staff";
}
function deriveUsernameFallback(email, name, id) {
  const fromEmail = (email || "").split("@")[0]?.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  if (fromEmail) return fromEmail;
  const fromName = (name || "").split(",")[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
  return fromName || `user.${id}`;
}
function hydrateMysqlUserRow(r) {
  const raw = safeJsonParse(r?.raw_json, {});
  const colPerms = safeJsonParse(
    r?.permissions_json ?? r?.permissions,
    null
  );
  const resolvedRole = normalizeMysqlUserRole(r?.role || raw.role || "staff");
  const basePerms = DEFAULT_PERMS_BY_ROLE[resolvedRole] || DEFAULT_PERMS_BY_ROLE.staff;
  const rawPerms = raw.permissions && typeof raw.permissions === "object" ? raw.permissions : colPerms && typeof colPerms === "object" ? colPerms : {};
  const mergedPerms = {
    canManagePrograms: colPerms?.canManagePrograms ?? rawPerms.canManagePrograms ?? basePerms.canManagePrograms,
    canCreateTor: colPerms?.canCreateTor ?? rawPerms.canCreateTor ?? basePerms.canCreateTor,
    canApproveTor: resolvedRole === "admin" ? false : colPerms?.canApproveTor ?? rawPerms.canApproveTor ?? basePerms.canApproveTor,
    canManageUsers: resolvedRole === "admin" ? true : colPerms?.canManageUsers ?? rawPerms.canManageUsers ?? basePerms.canManageUsers,
    canViewAllTors: colPerms?.canViewAllTors ?? rawPerms.canViewAllTors ?? basePerms.canViewAllTors
  };
  const sqlColPasswordHash = typeof r?.password_hash === "string" && r.password_hash.trim() || typeof r?.password === "string" && r.password.trim() || typeof r?.passwordHash === "string" && r.passwordHash.trim() || void 0;
  const rawJsonPasswordHash = typeof raw.passwordHash === "string" && raw.passwordHash.trim() || typeof raw.password_hash === "string" && raw.password_hash.trim() || typeof raw.password === "string" && raw.password.trim() || void 0;
  const resolvedPasswordHash = sqlColPasswordHash || rawJsonPasswordHash;
  const sqlHashDiffersFromRaw = Boolean(sqlColPasswordHash && rawJsonPasswordHash && sqlColPasswordHash !== rawJsonPasswordHash);
  const resolvedMustChangePassword = r?.must_change_password !== void 0 && r?.must_change_password !== null ? Boolean(Number(r.must_change_password)) : sqlHashDiffersFromRaw ? false : raw.mustChangePassword !== void 0 ? Boolean(raw.mustChangePassword) : false;
  const resolvedIsActive = r?.is_active !== void 0 && r?.is_active !== null ? Boolean(Number(r.is_active)) : raw.isActive !== false;
  const resolvedAccountStatus = typeof r?.account_status === "string" && r.account_status.trim() || raw.accountStatus || (resolvedIsActive ? "Aktif" : "Nonaktif");
  const id = String(r?.id || raw.id || "");
  const name = typeof r?.name === "string" && r.name.trim() || raw.name || "";
  const email = typeof r?.email === "string" && r.email.trim() || raw.email || "";
  const username = typeof r?.username === "string" && r.username.trim() || typeof raw.username === "string" && raw.username.trim() || deriveUsernameFallback(email, name, id);
  return {
    ...raw,
    id,
    username,
    name,
    email,
    passwordHash: resolvedPasswordHash,
    mustChangePassword: resolvedMustChangePassword,
    passwordUpdatedAt: r?.password_updated_at || raw.passwordUpdatedAt || r?.created_at || raw.createdAt || void 0,
    role: resolvedRole,
    roleTitle: typeof r?.role_title === "string" && r.role_title.trim() || raw.roleTitle || resolvedRole.toUpperCase(),
    department: typeof r?.department === "string" && r.department.trim() || raw.department || "",
    isActive: resolvedAccountStatus === "Aktif" && resolvedIsActive,
    accountStatus: resolvedAccountStatus,
    permissions: mergedPerms,
    lastLoginAt: r?.last_login_at || raw.lastLoginAt || void 0,
    createdAt: r?.created_at || raw.createdAt || "2026-01-10T08:00:00Z"
  };
}
async function fetchUsersFromMysql(pool) {
  const [userRows] = await pool.query("SELECT * FROM users");
  if (!Array.isArray(userRows)) {
    return [];
  }
  const hydrated = userRows.map(hydrateMysqlUserRow).filter((u) => Boolean(u.id));
  hydrated.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  return hydrated;
}
async function loadDatabaseFromMysql(pool, _fallbackSeed) {
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
      return null;
    }
  }
  const [programRows] = await pool.query("SELECT * FROM programs");
  const [outcomeRows] = await pool.query("SELECT * FROM outcomes");
  const [outputRows] = await pool.query("SELECT * FROM outputs");
  const [activityRows] = await pool.query("SELECT * FROM activities");
  const [subActivityRows] = await pool.query("SELECT * FROM sub_activities");
  const [torRows] = await pool.query("SELECT * FROM tors");
  const [approvalRows] = await pool.query("SELECT * FROM approval_records");
  const [caRows] = await pool.query("SELECT * FROM cash_advances");
  const [minutesRows] = await pool.query("SELECT * FROM meeting_minutes");
  const [participantRows] = await pool.query("SELECT * FROM participants");
  const [attendanceRows] = await pool.query("SELECT * FROM attendance_records");
  const [auditRows] = await pool.query("SELECT * FROM audit_logs");
  const [kvRows] = await pool.query("SELECT store_key, store_value FROM system_kv_store");
  const kvMap = {};
  if (Array.isArray(kvRows)) {
    for (const row of kvRows) {
      kvMap[row.store_key] = safeJsonParse(row.store_value, null);
    }
  }
  const parseAndHydrateRows = (rows, hydrator) => {
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => {
      const raw = safeJsonParse(r?.raw_json, {});
      return hydrator(r, raw);
    }).filter((item) => Boolean(item && item.id));
  };
  const programs = parseAndHydrateRows(programRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ""),
    code: r?.code || raw.code || "",
    name: r?.name || raw.name || "",
    description: r?.description ?? raw.description ?? "",
    donor: r?.donor ?? raw.donor ?? "",
    startDate: r?.start_date || raw.startDate || "",
    endDate: r?.end_date || raw.endDate || "",
    totalBudget: r?.total_budget !== void 0 && r?.total_budget !== null ? Number(r.total_budget) : Number(raw.totalBudget ?? raw.budget ?? 0),
    budget: raw.budget !== void 0 ? Number(raw.budget) : r?.total_budget !== void 0 && r?.total_budget !== null ? Number(r.total_budget) : Number(raw.totalBudget ?? 0),
    currency: r?.currency || raw.currency || "IDR",
    status: r?.status || raw.status || "Active",
    createdAt: r?.created_at || raw.createdAt || (/* @__PURE__ */ new Date()).toISOString()
  })).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const stripInternalCodePrefix = (val) => {
    const s = String(val ?? "");
    return s.includes("::") ? s.split("::").slice(1).join("::") : s;
  };
  const outcomes = parseAndHydrateRows(outcomeRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ""),
    programId: r?.program_id || raw.programId || "",
    outcomeNumber: raw.outcomeNumber || r?.outcome_number || stripInternalCodePrefix(r?.code) || void 0,
    code: stripInternalCodePrefix(r?.code) || raw.code || raw.outcomeNumber || "",
    name: r?.name || raw.name || raw.title || "",
    title: raw.title || r?.name || raw.name || "",
    description: r?.description ?? raw.description ?? "",
    indicators: Array.isArray(raw.indicators) ? raw.indicators : safeJsonParse(r?.indicators_json ?? r?.indicators, []),
    status: r?.status || raw.status || "Belum Dimulai",
    budgetAllocated: r?.budget_allocated !== void 0 && r?.budget_allocated !== null ? Number(r.budget_allocated) : Number(raw.budgetAllocated ?? raw.budget ?? 0),
    createdAt: r?.created_at || raw.createdAt || void 0,
    updatedAt: r?.updated_at || raw.updatedAt || void 0
  }));
  const outputs = parseAndHydrateRows(outputRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ""),
    programId: r?.program_id || raw.programId || "",
    outcomeId: r?.outcome_id || raw.outcomeId || "",
    outputNumber: raw.outputNumber || r?.output_number || stripInternalCodePrefix(r?.code) || void 0,
    code: stripInternalCodePrefix(r?.code) || raw.code || raw.outputNumber || "",
    name: r?.name || raw.name || raw.title || "",
    title: raw.title || r?.name || raw.name || "",
    description: r?.description ?? raw.description ?? "",
    indicators: Array.isArray(raw.indicators) ? raw.indicators : safeJsonParse(r?.indicators_json ?? r?.indicators, []),
    status: r?.status || raw.status || "Belum Dimulai",
    budgetAllocated: r?.budget_allocated !== void 0 && r?.budget_allocated !== null ? Number(r.budget_allocated) : Number(raw.budgetAllocated ?? raw.budget ?? 0),
    createdAt: r?.created_at || raw.createdAt || void 0,
    updatedAt: r?.updated_at || raw.updatedAt || void 0
  }));
  const activities = parseAndHydrateRows(activityRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ""),
    programId: r?.program_id || raw.programId || "",
    outcomeId: r?.outcome_id || raw.outcomeId || "",
    outputId: r?.output_id || raw.outputId || "",
    activityNumber: raw.activityNumber || r?.activity_number || void 0,
    code: stripInternalCodePrefix(r?.code) || raw.code || raw.activityNumber || "",
    name: r?.name || raw.name || raw.title || "",
    title: raw.title || r?.name || raw.name || "",
    description: r?.description ?? raw.description ?? "",
    startDate: r?.start_date || raw.startDate || "",
    endDate: r?.end_date || raw.endDate || "",
    status: r?.status || raw.status || "Belum Dimulai",
    budgetAllocated: r?.budget_allocated !== void 0 && r?.budget_allocated !== null ? Number(r.budget_allocated) : Number(raw.budgetAllocated ?? raw.budget ?? 0),
    createdAt: r?.created_at || raw.createdAt || void 0,
    updatedAt: r?.updated_at || raw.updatedAt || void 0
  }));
  const subActivities = parseAndHydrateRows(subActivityRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ""),
    programId: r?.program_id || raw.programId || "",
    outcomeId: r?.outcome_id || raw.outcomeId || "",
    outputId: r?.output_id || raw.outputId || "",
    activityId: r?.activity_id || raw.activityId || "",
    code: stripInternalCodePrefix(r?.code) || raw.code || "",
    name: r?.name || raw.name || "",
    description: r?.description ?? raw.description ?? "",
    picName: r?.pic_name || raw.picName || "",
    status: r?.status || raw.status || "Belum Dimulai",
    budgetAllocated: r?.budget_allocated !== void 0 && r?.budget_allocated !== null ? Number(r.budget_allocated) : Number(raw.budgetAllocated ?? raw.budget ?? 0),
    createdAt: r?.created_at || raw.createdAt || void 0,
    updatedAt: r?.updated_at || raw.updatedAt || void 0
  }));
  const tors = parseAndHydrateRows(torRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ""),
    torNumber: r?.tor_number ?? raw.torNumber,
    title: r?.title || raw.title || "",
    programId: r?.program_id || raw.programId || "",
    outcomeId: r?.outcome_id || raw.outcomeId || "",
    outputId: r?.output_id || raw.outputId || "",
    activityId: r?.activity_id || raw.activityId || "",
    createdById: raw.createdById || r?.created_by_user_id || "",
    createdByName: r?.created_by_name || raw.createdByName || "",
    status: r?.status || raw.status || "Draft",
    currentWorkflowStage: r?.current_stage !== void 0 && r?.current_stage !== null ? Number(r.current_stage) : Number(raw.currentWorkflowStage ?? 1),
    budgetRequested: r?.budget_requested !== void 0 && r?.budget_requested !== null ? Number(r.budget_requested) : Number(raw.budgetRequested ?? 0),
    budgetActualSpent: r?.budget_actual_spent !== void 0 && r?.budget_actual_spent !== null ? Number(r.budget_actual_spent) : Number(raw.budgetActualSpent ?? 0),
    startDate: r?.start_date || raw.startDate || "",
    endDate: r?.end_date || raw.endDate || "",
    location: r?.location || raw.location || "",
    createdAt: r?.created_at || raw.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: r?.updated_at || raw.updatedAt || (/* @__PURE__ */ new Date()).toISOString()
  })).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const approvalRecords = parseAndHydrateRows(approvalRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ""),
    torId: r?.tor_id || raw.torId || "",
    stage: r?.stage ?? raw.stage ?? 1,
    approverId: raw.approverId || r?.approver_user_id || "",
    approverName: r?.approver_name || raw.approverName || "",
    role: r?.role || raw.role || "",
    action: r?.action || raw.action || "",
    notes: r?.notes ?? raw.notes ?? raw.comment ?? "",
    comment: raw.comment ?? r?.notes ?? raw.notes ?? "",
    timestamp: r?.timestamp || raw.timestamp || (/* @__PURE__ */ new Date()).toISOString()
  })).sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || "")));
  const cashAdvances = parseAndHydrateRows(caRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ""),
    caNumber: r?.ca_number || raw.caNumber || raw.documentNumber || "",
    documentNumber: raw.documentNumber || r?.ca_number || raw.caNumber || "",
    torId: r?.tor_id || raw.torId || "",
    programId: r?.program_id || raw.programId || "",
    activityId: r?.activity_id || raw.activityId || "",
    requesterId: raw.requesterId || r?.requester_user_id || "",
    requesterName: r?.requester_name || raw.requesterName || "",
    totalAmount: r?.total_amount !== void 0 && r?.total_amount !== null ? Number(r.total_amount) : Number(raw.totalAmount ?? 0),
    realizedAmount: r?.realized_amount !== void 0 && r?.realized_amount !== null ? Number(r.realized_amount) : raw.realizedAmount !== void 0 ? Number(raw.realizedAmount) : void 0,
    status: r?.status || raw.status || "Draft",
    reportApprovalStatus: r?.report_approval_status ?? raw.reportApprovalStatus,
    createdAt: r?.created_at || raw.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: r?.updated_at || raw.updatedAt || (/* @__PURE__ */ new Date()).toISOString()
  })).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const meetingMinutes = parseAndHydrateRows(minutesRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ""),
    torId: r?.tor_id || raw.torId || "",
    activityId: r?.activity_id || raw.activityId || "",
    title: r?.title || raw.title || "",
    meetingDate: r?.meeting_date || raw.meetingDate || raw.date || "",
    date: raw.date || r?.meeting_date || raw.meetingDate || "",
    location: r?.location || raw.location || "",
    createdById: raw.createdById || r?.created_by_user_id || "",
    status: r?.status || raw.status || "Draft",
    createdAt: r?.created_at || raw.createdAt || (/* @__PURE__ */ new Date()).toISOString()
  })).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const participantDatabase = parseAndHydrateRows(participantRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ""),
    entityType: raw.entityType || r?.participant_type || "INDIVIDUAL",
    fullName: raw.fullName || r?.name || raw.name || "",
    name: r?.name || raw.name || raw.fullName || "",
    gender: r?.gender || raw.gender || void 0,
    institutionName: raw.institutionName || r?.organization_or_group || void 0,
    phoneNumber: raw.phoneNumber || r?.phone || void 0,
    cityOrRegency: raw.cityOrRegency || r?.village_or_city || void 0,
    createdAt: r?.created_at || raw.createdAt || (/* @__PURE__ */ new Date()).toISOString()
  })).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const hydratedAttendanceRecords = parseAndHydrateRows(attendanceRows, (r, raw) => {
    const rawHasActiveUnclosedClock = Boolean(raw && typeof raw.clockInTime === "string" && raw.clockInTime.trim() && !raw.clockInTime.startsWith("0000-00-00")) && (!raw.clockOutTime || String(raw.clockOutTime).trim() === "" || String(raw.clockOutTime).startsWith("0000-00-00"));
    const normalizedClockIn = normalizeHydratedAttendanceTimestamp(r?.clock_in_time, raw?.clockInTime, false);
    const normalizedClockOut = normalizeHydratedAttendanceTimestamp(
      r?.clock_out_time,
      raw?.clockOutTime,
      rawHasActiveUnclosedClock
    );
    return {
      ...raw,
      id: String(r?.id || raw.id || ""),
      date: toMysqlDateOnlyString(raw.date || r?.record_date) || String(r?.record_date || raw.date || ""),
      userId: r?.user_id || raw.userId || "",
      userName: r?.user_name || raw.userName || "",
      recordType: normalizedClockIn ? "ATTENDANCE" : r?.record_type || raw.recordType || "ATTENDANCE",
      clockInTime: normalizedClockIn,
      clockOutTime: normalizedClockOut,
      totalWorkHours: r?.total_work_hours !== void 0 && r?.total_work_hours !== null ? Number(r.total_work_hours) : Number(raw.totalWorkHours ?? 0),
      isOutsideWorkLocation: r?.is_outside_work_location !== void 0 && r?.is_outside_work_location !== null ? Boolean(Number(r.is_outside_work_location)) : Boolean(raw.isOutsideWorkLocation),
      createdAt: r?.created_at || raw.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: r?.updated_at || raw.updatedAt || (/* @__PURE__ */ new Date()).toISOString()
    };
  }).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const auditLogs = parseAndHydrateRows(auditRows, (r, raw) => ({
    ...raw,
    id: String(r?.id || raw.id || ""),
    torId: r?.tor_id || raw.torId || void 0,
    actorId: raw.actorId || r?.user_id || "system",
    actorName: raw.actorName || r?.user_name || "System",
    actorRole: raw.actorRole || r?.user_role || "",
    action: r?.action || raw.action || "",
    entityType: raw.entityType || (r?.tor_id ? "TOR" : "SYSTEM"),
    entityId: raw.entityId || r?.tor_id || "system",
    details: r?.details || raw.details || "",
    timestamp: r?.timestamp || raw.timestamp || (/* @__PURE__ */ new Date()).toISOString()
  })).sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
  const attendanceSystem = kvMap["attendanceSystem"] || {
    locationConfig: {
      officeName: "Kantor Pusat Yayasan WIJNA",
      address: "Kantor WIJNA (-7.342604, 110.489848)",
      latitude: -7.342604,
      longitude: 110.489848,
      radiusMeters: 5,
      standardDailyHours: 8
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
    auditTrail: []
  };
  const kvAttendanceRecords = Array.isArray(attendanceSystem.records) ? attendanceSystem.records : [];
  if (hydratedAttendanceRecords.length > 0) {
    const mergedById = /* @__PURE__ */ new Map();
    for (const rec of hydratedAttendanceRecords) {
      if (rec && rec.id) {
        mergedById.set(String(rec.id), rec);
      }
    }
    for (const kvRec of kvAttendanceRecords) {
      if (!kvRec || !kvRec.id) continue;
      const recId = String(kvRec.id);
      const isKvActiveClock = Boolean(kvRec.clockInTime) && !String(kvRec.clockInTime).startsWith("0000-00-00") && (!kvRec.clockOutTime || String(kvRec.clockOutTime).startsWith("0000-00-00"));
      if (!mergedById.has(recId) && isKvActiveClock) {
        mergedById.set(recId, { ...kvRec, clockOutTime: void 0 });
      }
    }
    attendanceSystem.records = Array.from(mergedById.values()).sort(
      (a, b) => String(b.date || "").localeCompare(String(a.date || ""))
    );
  } else {
    attendanceSystem.records = kvAttendanceRecords;
  }
  return {
    users,
    currentUserId: kvMap["currentUserId"] || users[0]?.id || "user-director",
    programs,
    outcomes,
    outputs,
    activities,
    subActivities,
    tors,
    approvalRecords,
    auditLogs,
    cashAdvances,
    cashAdvanceSummaries: kvMap["cashAdvanceSummaries"] || {},
    cashAdvanceAuditLogs: kvMap["cashAdvanceAuditLogs"] || {},
    meetingMinutes,
    activityDocumentations: kvMap["activityDocumentations"] || {},
    activityDocumentationList: kvMap["activityDocumentationList"] || [],
    outputRaciRecords: kvMap["outputRaciRecords"] || {},
    activityMonitoringRecords: kvMap["activityMonitoringRecords"] || {},
    monitoringReports: kvMap["monitoringReports"] || {},
    approvalHubItems: kvMap["approvalHubItems"] || {},
    approvalWorkflowConfigs: kvMap["approvalWorkflowConfigs"] || {},
    approvalNotifications: kvMap["approvalNotifications"] || [],
    programBudgets: kvMap["programBudgets"] || {},
    participantDatabase,
    attendanceSystem,
    organizationSettings: kvMap["organizationSettings"] || void 0,
    cleanResetPrj3581V1: kvMap["cleanResetPrj3581V1"] !== void 0 ? Boolean(kvMap["cleanResetPrj3581V1"]) : void 0,
    cleanResetPrj3581V2: kvMap["cleanResetPrj3581V2"] !== void 0 ? Boolean(kvMap["cleanResetPrj3581V2"]) : void 0
  };
}
var tableColumnsCache = /* @__PURE__ */ new Map();
function safeFiniteNumber(val, fallback = 0) {
  if (val === null || val === void 0 || val === "") return fallback;
  if (typeof val === "boolean") return val ? 1 : 0;
  const num = typeof val === "number" ? val : Number(val);
  return Number.isFinite(num) ? num : fallback;
}
function toMysqlDateTimeString(val) {
  if (val === null || val === void 0 || val === "") return null;
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return null;
    return val.toISOString().slice(0, 19).replace("T", " ");
  }
  const s = String(val).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s} 00:00:00`;
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 19).replace("T", " ");
  }
  return null;
}
function toMysqlDateOnlyString(val) {
  if (val === null || val === void 0 || val === "") return null;
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
function normalizeHydratedAttendanceTimestamp(colVal, rawVal, isExplicitlyActiveInRawJson = false) {
  const cleanIsoOrTime = (v) => {
    if (v === null || v === void 0) return void 0;
    if (v instanceof Date) {
      return Number.isNaN(v.getTime()) ? void 0 : v.toISOString();
    }
    const s = String(v).trim();
    if (!s || s.startsWith("0000-00-00")) return void 0;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(s)) {
      return `${s.replace(" ", "T")}Z`;
    }
    return s;
  };
  const fromRaw = cleanIsoOrTime(rawVal);
  if (fromRaw) return fromRaw;
  if (isExplicitlyActiveInRawJson) return void 0;
  return cleanIsoOrTime(colVal);
}
function formatValueForMysqlColumn(val, colMeta) {
  const typeLower = (colMeta.type || "").toLowerCase();
  const colNameLower = (colMeta.name || "").toLowerCase();
  const isForeignIdLike = colNameLower !== "id" && colNameLower !== "store_key" && (colNameLower.endsWith("_id") || colNameLower.endsWith("_by"));
  const isUniqueIndexed = String(colMeta.key || "").toUpperCase() === "UNI";
  const canLeaveNull = colMeta.nullable || colMeta.hasDefault || colMeta.extra.includes("auto_increment");
  const fallbackForStrictNotNull = () => {
    if (typeLower.includes("int") || typeLower.includes("decimal") || typeLower.includes("numeric") || typeLower.includes("float") || typeLower.includes("double") || typeLower.includes("bit")) {
      return 0;
    }
    if (typeLower.startsWith("datetime") || typeLower.startsWith("timestamp")) {
      if (colNameLower === "clock_out_time") {
        return "0000-00-00 00:00:00";
      }
      return (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
    }
    if (typeLower === "date") {
      return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    }
    if (typeLower.includes("json")) {
      return "{}";
    }
    return "";
  };
  if (val === "" && (isForeignIdLike || isUniqueIndexed) && canLeaveNull) {
    return null;
  }
  if (val === void 0 || val === null) {
    return canLeaveNull ? null : fallbackForStrictNotNull();
  }
  if (typeLower.startsWith("datetime") || typeLower.startsWith("timestamp")) {
    const dt = toMysqlDateTimeString(val);
    if (dt !== null) return dt;
    return canLeaveNull ? null : fallbackForStrictNotNull();
  }
  if (typeLower === "date") {
    const d = toMysqlDateOnlyString(val);
    if (d !== null) return d;
    return canLeaveNull ? null : fallbackForStrictNotNull();
  }
  if (typeLower.includes("int") || typeLower.includes("decimal") || typeLower.includes("numeric") || typeLower.includes("float") || typeLower.includes("double") || typeLower.includes("bit")) {
    const num = safeFiniteNumber(val, null);
    if (num !== null) return num;
    return canLeaveNull ? null : 0;
  }
  if (typeLower.includes("json")) {
    if (typeof val === "string") {
      try {
        JSON.parse(val);
        return val;
      } catch {
        return JSON.stringify(val);
      }
    }
    return JSON.stringify(val);
  }
  const strVal = typeof val === "object" ? JSON.stringify(val) : String(val);
  const lenMatch = typeLower.match(/(?:var)?char\((\d+)\)/);
  if (lenMatch) {
    const maxLen = parseInt(lenMatch[1], 10);
    if (Number.isFinite(maxLen) && maxLen > 0 && strVal.length > maxLen) {
      return strVal.slice(0, maxLen);
    }
  }
  return strVal;
}
async function ensureSingleMissingTableFromSchema(connOrPool, tableName) {
  const candidatePaths = [
    path.resolve(process.cwd(), "database", "schema.sql"),
    path.resolve(__poolDir, "database", "schema.sql"),
    path.resolve(__poolDir, "..", "..", "database", "schema.sql")
  ];
  const schemaPath = candidatePaths.find((p) => fs.existsSync(p));
  if (!schemaPath) return;
  const sqlContent = fs.readFileSync(schemaPath, "utf-8");
  const cleanedSql = sqlContent.replace(/^\s*--.*$/gm, "");
  const statements = cleanedSql.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
  const targetRegex = new RegExp(
    `^CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+\`?${tableName}\`?\\b`,
    "i"
  );
  for (const stmt of statements) {
    if (targetRegex.test(stmt)) {
      await connOrPool.query(stmt);
      return;
    }
  }
}
async function describeTableColumns(connOrPool, tableName) {
  const cached = tableColumnsCache.get(tableName);
  if (cached && cached.size > 0) {
    return cached;
  }
  let rows;
  try {
    const [res] = await connOrPool.query(`SHOW COLUMNS FROM \`${tableName}\``);
    rows = Array.isArray(res) ? res : [];
  } catch (err) {
    if (err?.code === "ER_NO_SUCH_TABLE") {
      await ensureSingleMissingTableFromSchema(connOrPool, tableName);
      const [retryRes] = await connOrPool.query(`SHOW COLUMNS FROM \`${tableName}\``);
      rows = Array.isArray(retryRes) ? retryRes : [];
    } else {
      throw err;
    }
  }
  const colMap = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const fieldName = String(r.Field || r.field || "").trim();
    if (!fieldName) continue;
    colMap.set(fieldName, {
      name: fieldName,
      type: String(r.Type || r.type || "varchar(255)"),
      nullable: String(r.Null || r.null || "YES").toUpperCase() === "YES",
      key: String(r.Key || r.key || ""),
      hasDefault: r.Default !== null && r.Default !== void 0,
      extra: String(r.Extra || r.extra || "").toLowerCase()
    });
  }
  if (colMap.size > 0) {
    tableColumnsCache.set(tableName, colMap);
  }
  return colMap;
}
async function checkMysqlWritePrivileges(pool) {
  try {
    const [rows] = await pool.query("SHOW GRANTS FOR CURRENT_USER()");
    const grantLines = Array.isArray(rows) ? rows.map((r) => String(Object.values(r || {})[0] || "").toUpperCase()) : [];
    let canSelect = false;
    let canInsert = false;
    let canUpdate = false;
    let canDelete = false;
    for (const line of grantLines) {
      const match = line.match(/^GRANT\s+(.+?)\s+ON\s+/i);
      const privPart = match ? match[1] : line;
      if (privPart.includes("ALL PRIVILEGES") || /\bALL\b/.test(privPart)) {
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
      rawSummary: summaryText
    };
  } catch {
    return {
      checked: false,
      canSelect: true,
      canInsert: true,
      canUpdate: true,
      canDelete: true,
      rawSummary: "Privilege inspection skipped (SHOW GRANTS restricted by host)"
    };
  }
}
async function executeAdaptiveUpsert(connOrPool, tableName, candidateRow, options) {
  const colMetaMap = await describeTableColumns(connOrPool, tableName);
  const pkCol = options?.primaryKeyColumn || "id";
  const immutableSet = /* @__PURE__ */ new Set([
    pkCol,
    ...options?.immutableOnUpdateColumns || ["created_at"]
  ]);
  const preserveNonEmptySet = new Set(options?.preserveNonEmptyColumns || []);
  const coalesceIfNullSet = new Set(options?.coalesceIfNullColumns || []);
  const selectedCols = [];
  const params = [];
  for (const [colName, colMeta] of colMetaMap.entries()) {
    if (colMeta.extra.includes("auto_increment") && candidateRow[colName] === void 0) {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(candidateRow, colName)) {
      let rawCandidateVal = candidateRow[colName];
      if (colName === "code" && String(colMeta.key || "").toUpperCase() === "UNI" && (tableName === "outcomes" || tableName === "outputs" || tableName === "activities" || tableName === "sub_activities")) {
        const baseCode = typeof rawCandidateVal === "string" && rawCandidateVal.trim() !== "" ? rawCandidateVal.trim() : String(candidateRow[pkCol] || "");
        const progTag = candidateRow.program_id ? String(candidateRow.program_id).slice(-8) : "";
        rawCandidateVal = progTag && !baseCode.includes("::") ? `${progTag}::${baseCode}` : baseCode;
      }
      let formatted = formatValueForMysqlColumn(rawCandidateVal, colMeta);
      if ((formatted === null || formatted === "") && !colMeta.nullable && !colMeta.hasDefault && String(colMeta.key || "").toUpperCase() === "UNI") {
        formatted = String(candidateRow[pkCol] || "").slice(0, 64);
      }
      selectedCols.push(colName);
      params.push(formatted);
    } else if (!colMeta.nullable && !colMeta.hasDefault && !colMeta.extra.includes("auto_increment")) {
      let fallbackVal = formatValueForMysqlColumn(null, colMeta);
      if ((fallbackVal === null || fallbackVal === "") && String(colMeta.key || "").toUpperCase() === "UNI") {
        fallbackVal = String(candidateRow[pkCol] || "").slice(0, 64);
      }
      selectedCols.push(colName);
      params.push(fallbackVal);
    }
  }
  if (selectedCols.length === 0) {
    throw new Error(`No matching columns found for MySQL table '${tableName}'.`);
  }
  const quotedCols = selectedCols.map((c) => `\`${c}\``).join(", ");
  const placeholders = selectedCols.map(() => "?").join(", ");
  const updateAssignments = [];
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
  const sql = `INSERT INTO \`${tableName}\` (${quotedCols}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updateAssignments.join(", ")}`;
  const [result] = await connOrPool.query(sql, params);
  return Number(result?.affectedRows || 0);
}
function buildUserCandidateRow(u, nowIso) {
  const effectiveHash = typeof u.passwordHash === "string" && u.passwordHash.trim() || typeof u.password_hash === "string" && u.password_hash.trim() || null;
  const effectiveUsername = u.username || deriveUsernameFallback(u.email || "", u.name || "", String(u.id || ""));
  const permsJson = JSON.stringify(u.permissions || {});
  return {
    id: String(u.id).slice(0, 128),
    username: truncStr(effectiveUsername, 128),
    name: truncStr(u.name, 255) || "",
    email: truncStr(u.email, 255) || "",
    password_hash: truncStr(effectiveHash, 255),
    password: truncStr(effectiveHash, 255),
    role: truncStr(u.role, 64) || "staff",
    role_title: truncStr(u.roleTitle, 255) || truncStr(u.role, 64) || "Staff",
    department: truncStr(u.department, 255),
    is_active: u.isActive === false ? 0 : 1,
    account_status: truncStr(u.accountStatus || (u.isActive === false ? "Nonaktif" : "Aktif"), 64),
    must_change_password: u.mustChangePassword ? 1 : 0,
    password_updated_at: u.passwordUpdatedAt || null,
    permissions_json: permsJson,
    permissions: permsJson,
    last_login_at: u.lastLoginAt || null,
    created_at: u.createdAt || nowIso,
    updated_at: nowIso,
    raw_json: JSON.stringify(u)
  };
}
function buildProgramCandidateRow(p, nowIso) {
  return {
    id: String(p.id).slice(0, 128),
    code: truncStr(p.code, 64),
    name: truncStr(p.name, 255) || "",
    location: truncStr(p.location, 255),
    description: p.description || null,
    donor: truncStr(p.donor, 255),
    start_date: truncStr(p.startDate, 32),
    end_date: truncStr(p.endDate, 32),
    total_budget: safeFiniteNumber(p.totalBudget ?? p.budget, 0),
    currency: truncStr(p.currency || "IDR", 16),
    status: truncStr(p.status || "Aktif", 64),
    created_at: p.createdAt || nowIso,
    updated_at: p.updatedAt || nowIso,
    raw_json: JSON.stringify(p)
  };
}
function buildOutcomeCandidateRow(oc, nowIso) {
  const ts = nowIso || (/* @__PURE__ */ new Date()).toISOString();
  const effectiveName = truncStr(oc.name || oc.title, 500) || "";
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
    status: truncStr(oc.status || "Belum Dimulai", 64),
    budget_allocated: safeFiniteNumber(oc.budgetAllocated ?? oc.budget, 0),
    indicators_json: indicatorsJson,
    indicators: indicatorsJson,
    created_at: oc.createdAt || ts,
    updated_at: oc.updatedAt || ts,
    raw_json: JSON.stringify(oc)
  };
}
function buildOutputCandidateRow(op, nowIso) {
  const ts = nowIso || (/* @__PURE__ */ new Date()).toISOString();
  const effectiveName = truncStr(op.name || op.title, 500) || "";
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
    status: truncStr(op.status || "Belum Dimulai", 64),
    budget_allocated: safeFiniteNumber(op.budgetAllocated ?? op.budget, 0),
    indicators_json: indicatorsJson,
    indicators: indicatorsJson,
    created_at: op.createdAt || ts,
    updated_at: op.updatedAt || ts,
    raw_json: JSON.stringify(op)
  };
}
function buildActivityCandidateRow(ac, nowIso) {
  const ts = nowIso || (/* @__PURE__ */ new Date()).toISOString();
  const effectiveName = truncStr(ac.name || ac.title, 500) || "";
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
    status: truncStr(ac.status || "Belum Dimulai", 64),
    budget_allocated: safeFiniteNumber(ac.budgetAllocated ?? ac.budget, 0),
    created_at: ac.createdAt || ts,
    updated_at: ac.updatedAt || ts,
    raw_json: JSON.stringify(ac)
  };
}
function buildSubActivityCandidateRow(sa, nowIso) {
  const ts = nowIso || (/* @__PURE__ */ new Date()).toISOString();
  const effectiveName = truncStr(sa.name, 500) || "";
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
    status: truncStr(sa.status || "Belum Dimulai", 64),
    budget_allocated: safeFiniteNumber(sa.budgetAllocated ?? sa.budget, 0),
    created_at: sa.createdAt || ts,
    updated_at: sa.updatedAt || ts,
    raw_json: JSON.stringify(sa)
  };
}
function buildTorCandidateRow(t, nowIso) {
  return {
    id: String(t.id).slice(0, 128),
    tor_number: truncStr(t.torNumber || t.documentNumber, 128),
    title: truncStr(t.title, 500) || "",
    program_id: truncStr(t.programId, 128),
    outcome_id: truncStr(t.outcomeId, 128),
    output_id: truncStr(t.outputId, 128),
    activity_id: truncStr(t.activityId, 128),
    created_by_user_id: truncStr(t.createdByUserId || t.createdById || t.picId, 128),
    created_by_name: truncStr(t.createdByName || t.picName, 255),
    status: truncStr(t.submissionStatus || t.status || "Draft", 128),
    current_stage: safeFiniteNumber(t.currentWorkflowStage ?? t.currentStage, 1),
    budget_requested: safeFiniteNumber(t.budgetRequested, null),
    budget_actual_spent: safeFiniteNumber(t.budgetActualSpent, null),
    start_date: truncStr(t.startDate, 32),
    end_date: truncStr(t.endDate, 32),
    location: truncStr(t.location, 255),
    created_at: t.createdAt || nowIso,
    updated_at: t.updatedAt || nowIso,
    raw_json: JSON.stringify(t)
  };
}
function buildApprovalRecordCandidateRow(ar, nowIso) {
  return {
    id: String(ar.id).slice(0, 128),
    tor_id: truncStr(ar.torId, 128) || "",
    // Mendukung stage bertipe INT maupun VARCHAR tanpa pernah menghasilkan NaN
    stage: ar.stage ?? null,
    approver_user_id: truncStr(ar.approverUserId || ar.approverId || ar.reviewerId, 128),
    approver_name: truncStr(ar.approverName || ar.reviewerName, 255),
    role: truncStr(ar.role || ar.reviewerRole, 128),
    action: truncStr(ar.action || ar.decision, 128),
    notes: ar.notes ?? ar.comment ?? null,
    timestamp: ar.timestamp || nowIso,
    raw_json: JSON.stringify(ar)
  };
}
function buildCashAdvanceCandidateRow(ca, nowIso) {
  return {
    id: String(ca.id).slice(0, 128),
    ca_number: truncStr(ca.caNumber || ca.documentNumber, 128),
    tor_id: truncStr(ca.torId, 128),
    program_id: truncStr(ca.programId, 128),
    activity_id: truncStr(ca.activityId, 128),
    requester_user_id: truncStr(ca.requesterUserId || ca.requesterId || ca.submittedByUserId, 128),
    requester_name: truncStr(ca.requesterName || ca.submittedByName, 255),
    total_amount: safeFiniteNumber(ca.totalAmount ?? ca.requestedAmount, 0),
    realized_amount: safeFiniteNumber(ca.realizedAmount ?? ca.actualSpentAmount, null),
    status: truncStr(ca.status || "Draft", 128),
    report_approval_status: truncStr(ca.reportApprovalStatus, 128),
    created_at: ca.createdAt || nowIso,
    updated_at: ca.updatedAt || nowIso,
    raw_json: JSON.stringify(ca)
  };
}
function buildMeetingMinuteCandidateRow(mm, nowIso) {
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
    raw_json: JSON.stringify(mm)
  };
}
function buildParticipantCandidateRow(pt, nowIso) {
  return {
    id: String(pt.id).slice(0, 128),
    participant_type: truncStr(pt.entityType || pt.participantType || "INDIVIDUAL", 64),
    name: truncStr(pt.fullName || pt.groupName || pt.name, 255) || "",
    gender: truncStr(pt.gender, 32),
    organization_or_group: truncStr(pt.institutionName || pt.groupName, 255),
    phone: truncStr(pt.phoneNumber || pt.contactPhone, 64),
    village_or_city: truncStr(pt.cityOrRegency || pt.villageOrSubdistrict, 255),
    created_at: pt.createdAt || nowIso,
    raw_json: JSON.stringify(pt)
  };
}
function buildAttendanceRecordCandidateRow(att, nowIso) {
  const cleanClockIn = typeof att.clockInTime === "string" && att.clockInTime.trim() && !att.clockInTime.startsWith("0000-00-00") ? truncStr(att.clockInTime, 64) : null;
  const cleanClockOut = typeof att.clockOutTime === "string" && att.clockOutTime.trim() && !att.clockOutTime.startsWith("0000-00-00") ? truncStr(att.clockOutTime, 64) : null;
  return {
    id: String(att.id).slice(0, 128),
    record_date: truncStr(att.date, 32) || "",
    user_id: truncStr(att.userId, 128) || "",
    user_name: truncStr(att.userName, 255),
    record_type: truncStr(cleanClockIn ? "ATTENDANCE" : att.recordType || "ATTENDANCE", 64),
    clock_in_time: cleanClockIn,
    clock_out_time: cleanClockOut,
    total_work_hours: safeFiniteNumber(att.totalWorkHours, 0),
    is_outside_work_location: att.isOutsideWorkLocation ? 1 : 0,
    created_at: att.createdAt || nowIso,
    updated_at: att.updatedAt || nowIso,
    raw_json: JSON.stringify({
      ...att,
      clockInTime: cleanClockIn ?? void 0,
      clockOutTime: cleanClockOut ?? void 0
    })
  };
}
function buildAuditLogCandidateRow(al, nowIso) {
  return {
    id: String(al.id).slice(0, 128),
    tor_id: truncStr(al.torId || (al.entityType === "TOR" ? al.entityId : null), 128),
    user_id: truncStr(al.userId || al.actorId, 128),
    user_name: truncStr(al.userName || al.actorName, 255),
    user_role: truncStr(al.userRole || al.actorRole, 64),
    action: truncStr(al.action, 255) || "",
    details: al.details || null,
    timestamp: al.timestamp || nowIso,
    raw_json: JSON.stringify(al)
  };
}
function extractKvSnapshot(data) {
  const kvEntries = {
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
    cleanResetPrj3581V2: data.cleanResetPrj3581V2 ?? true
  };
  if (data.organizationSettings !== void 0) {
    kvEntries.organizationSettings = data.organizationSettings;
  }
  return kvEntries;
}
async function upsertMysqlKvEntries(pool, entries) {
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  for (const [k, v] of Object.entries(entries)) {
    if (v === void 0) continue;
    await executeAdaptiveUpsert(
      pool,
      "system_kv_store",
      {
        store_key: String(k).slice(0, 128),
        store_value: JSON.stringify(v),
        updated_at: nowIso
      },
      {
        primaryKeyColumn: "store_key",
        immutableOnUpdateColumns: []
      }
    );
  }
}
async function upsertMysqlUserRow(pool, u) {
  if (!u || !u.id) return 0;
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  return executeAdaptiveUpsert(pool, "users", buildUserCandidateRow(u, nowIso), {
    primaryKeyColumn: "id",
    immutableOnUpdateColumns: ["created_at"],
    preserveNonEmptyColumns: ["password_hash", "password"],
    coalesceIfNullColumns: ["last_login_at"]
  });
}
async function deleteMysqlUserRow(pool, userId) {
  if (!userId) return 0;
  const [result] = await pool.query("DELETE FROM `users` WHERE `id` = ?", [
    String(userId).slice(0, 128)
  ]);
  return Number(result?.affectedRows || 0);
}
var ENTITY_TABLE_SPECS = [
  {
    tableName: "users",
    getRows: (d) => d.users || [],
    buildCandidate: buildUserCandidateRow,
    allowTargetedDelete: false,
    // Penghapusan user hanya boleh melalui deleteMysqlUserRow eksplisit
    upsertOptions: {
      primaryKeyColumn: "id",
      immutableOnUpdateColumns: ["created_at"],
      preserveNonEmptyColumns: ["password_hash", "password"],
      coalesceIfNullColumns: ["last_login_at"]
    }
  },
  {
    tableName: "programs",
    getRows: (d) => d.programs || [],
    buildCandidate: buildProgramCandidateRow,
    allowTargetedDelete: true
  },
  {
    tableName: "outcomes",
    getRows: (d) => d.outcomes || [],
    buildCandidate: (oc, nowIso) => buildOutcomeCandidateRow(oc, nowIso),
    allowTargetedDelete: true
  },
  {
    tableName: "outputs",
    getRows: (d) => d.outputs || [],
    buildCandidate: (op, nowIso) => buildOutputCandidateRow(op, nowIso),
    allowTargetedDelete: true
  },
  {
    tableName: "activities",
    getRows: (d) => d.activities || [],
    buildCandidate: (ac, nowIso) => buildActivityCandidateRow(ac, nowIso),
    allowTargetedDelete: true
  },
  {
    tableName: "sub_activities",
    getRows: (d) => d.subActivities || [],
    buildCandidate: (sa, nowIso) => buildSubActivityCandidateRow(sa, nowIso),
    allowTargetedDelete: true
  },
  {
    tableName: "tors",
    getRows: (d) => d.tors || [],
    buildCandidate: buildTorCandidateRow,
    allowTargetedDelete: true
  },
  {
    tableName: "approval_records",
    getRows: (d) => d.approvalRecords || [],
    buildCandidate: buildApprovalRecordCandidateRow,
    allowTargetedDelete: true
  },
  {
    tableName: "cash_advances",
    getRows: (d) => d.cashAdvances || [],
    buildCandidate: buildCashAdvanceCandidateRow,
    allowTargetedDelete: true
  },
  {
    tableName: "meeting_minutes",
    getRows: (d) => d.meetingMinutes || [],
    buildCandidate: buildMeetingMinuteCandidateRow,
    allowTargetedDelete: true
  },
  {
    tableName: "participants",
    getRows: (d) => d.participantDatabase || [],
    buildCandidate: buildParticipantCandidateRow,
    allowTargetedDelete: true
  },
  {
    tableName: "attendance_records",
    getRows: (d) => d.attendanceSystem?.records || [],
    buildCandidate: buildAttendanceRecordCandidateRow,
    allowTargetedDelete: true
  },
  {
    tableName: "audit_logs",
    getRows: (d) => d.auditLogs || [],
    buildCandidate: buildAuditLogCandidateRow,
    allowTargetedDelete: false
  }
];
async function saveDiffToMysql(pool, prevData, nextData, contextLabel = "write") {
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const plannedOps = [];
  for (const spec of ENTITY_TABLE_SPECS) {
    const prevRows = (spec.getRows(prevData) || []).filter((r) => r && r.id);
    const nextRows = (spec.getRows(nextData) || []).filter((r) => r && r.id);
    const prevSerializedById = /* @__PURE__ */ new Map();
    for (const r of prevRows) {
      prevSerializedById.set(String(r.id), JSON.stringify(r));
    }
    const nextIds = /* @__PURE__ */ new Set();
    const toUpsert = [];
    for (const r of nextRows) {
      const id = String(r.id);
      nextIds.add(id);
      const serialized = JSON.stringify(r);
      if (prevSerializedById.get(id) !== serialized) {
        toUpsert.push(r);
      }
    }
    const toDeleteIds = [];
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
  const changedKvEntries = [];
  for (const [k, v] of Object.entries(nextKv)) {
    if (v === void 0) continue;
    const nextSerialized = JSON.stringify(v);
    const prevSerialized = prevKv[k] !== void 0 ? JSON.stringify(prevKv[k]) : void 0;
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
      touchedTables: []
    };
  }
  const touchedTables = [
    ...plannedOps.map((p) => p.spec.tableName),
    ...changedKvEntries.length > 0 ? ["system_kv_store"] : []
  ];
  console.log(
    `[WRITE] DATABASE QUERY STARTED (${contextLabel}) -> tables=[${touchedTables.join(", ")}]`
  );
  const conn = await pool.getConnection();
  let totalAffectedRows = 0;
  let upsertedRows = 0;
  let deletedRows = 0;
  let activeTable = "";
  let activeOperation = "";
  try {
    await conn.beginTransaction();
    for (const op of [...plannedOps].reverse()) {
      if (op.toDeleteIds.length === 0) continue;
      activeTable = op.spec.tableName;
      activeOperation = "DELETE";
      for (const delId of op.toDeleteIds) {
        const [delRes] = await conn.query(
          `DELETE FROM \`${op.spec.tableName}\` WHERE \`id\` = ?`,
          [delId.slice(0, 128)]
        );
        deletedRows += 1;
        totalAffectedRows += Number(delRes?.affectedRows || 0);
      }
    }
    for (const op of plannedOps) {
      if (op.toUpsert.length === 0) continue;
      activeTable = op.spec.tableName;
      activeOperation = "UPSERT";
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
      activeTable = "system_kv_store";
      activeOperation = "UPSERT_KV";
      for (const [kvKey, kvJson] of changedKvEntries) {
        const affected = await executeAdaptiveUpsert(
          conn,
          "system_kv_store",
          {
            store_key: kvKey.slice(0, 128),
            store_value: kvJson,
            updated_at: nowIso
          },
          {
            primaryKeyColumn: "store_key",
            immutableOnUpdateColumns: []
          }
        );
        totalAffectedRows += affected;
      }
    }
    activeOperation = "COMMIT";
    await conn.commit();
    console.log(
      `[WRITE] DATABASE QUERY SUCCESS (${contextLabel}) -> upserted=${upsertedRows}, deleted=${deletedRows}, kvUpdated=${changedKvEntries.length}, affectedRows=${totalAffectedRows}`
    );
    return {
      upsertedRows,
      deletedRows,
      updatedKvKeys: changedKvEntries.length,
      totalAffectedRows,
      touchedTables
    };
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
    }
    if (err && typeof err === "object") {
      err.failedTable = activeTable || void 0;
      err.failedOperation = activeOperation || void 0;
    }
    const safeCode = err?.code ? ` [${err.code}]` : "";
    const safeMsg = String(err?.message || err || "Unknown SQL error").replace(/mysql2?:\/\/[^\s@]+@/gi, "mysql://***@").replace(/(password\s*[=:]\s*)([^\s,;]+)/gi, "$1***");
    console.error(
      `[WRITE] DATABASE QUERY FAILED (${contextLabel}) table=${activeTable || "unknown"} op=${activeOperation || "unknown"}${safeCode}: ${safeMsg}`
    );
    throw err;
  } finally {
    conn.release();
  }
}
async function importProgramHierarchyToMysql(pool, params) {
  const {
    programId,
    outcomesToUpsert,
    outputsToUpsert,
    activitiesToUpsert,
    subActivitiesToUpsert,
    auditLog
  } = params;
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const conn = await pool.getConnection();
  let currentStage = "DATABASE TRANSACTION STARTED";
  let currentTable = "programs";
  let totalAffectedRows = 0;
  try {
    console.log(`[IMPORT] DATABASE TRANSACTION STARTED (programId=${programId})`);
    await conn.beginTransaction();
    currentStage = "PROGRAM VERIFICATION";
    currentTable = "programs";
    const [progRows] = await conn.query(
      "SELECT `id`, `name` FROM `programs` WHERE `id` = ? LIMIT 1",
      [String(programId).slice(0, 128)]
    );
    if (!Array.isArray(progRows) || progRows.length === 0) {
      throw Object.assign(
        new Error(`Parent program '${programId}' was not found in MySQL table 'programs'.`),
        {
          code: "PROGRAM_NOT_FOUND_IN_MYSQL",
          failedTable: "programs",
          failedStage: currentStage
        }
      );
    }
    console.log(`[IMPORT] PROGRAM VERIFIED (programId=${programId})`);
    currentStage = "OUTCOME INSERT";
    currentTable = "outcomes";
    console.log(`[IMPORT] OUTCOME INSERT STARTED (count=${outcomesToUpsert.length})`);
    for (const oc of outcomesToUpsert) {
      const affected = await executeAdaptiveUpsert(
        conn,
        "outcomes",
        buildOutcomeCandidateRow({ ...oc, programId }, nowIso)
      );
      totalAffectedRows += affected;
    }
    currentStage = "OUTPUT INSERT";
    currentTable = "outputs";
    console.log(`[IMPORT] OUTPUT INSERT STARTED (count=${outputsToUpsert.length})`);
    for (const op of outputsToUpsert) {
      const affected = await executeAdaptiveUpsert(
        conn,
        "outputs",
        buildOutputCandidateRow({ ...op, programId }, nowIso)
      );
      totalAffectedRows += affected;
    }
    currentStage = "ACTIVITY INSERT";
    currentTable = "activities";
    console.log(`[IMPORT] ACTIVITY INSERT STARTED (count=${activitiesToUpsert.length})`);
    for (const ac of activitiesToUpsert) {
      const affected = await executeAdaptiveUpsert(
        conn,
        "activities",
        buildActivityCandidateRow({ ...ac, programId }, nowIso)
      );
      totalAffectedRows += affected;
    }
    if (subActivitiesToUpsert.length > 0) {
      currentStage = "SUB_ACTIVITY INSERT";
      currentTable = "sub_activities";
      console.log(`[IMPORT] SUB_ACTIVITY INSERT STARTED (count=${subActivitiesToUpsert.length})`);
      for (const sa of subActivitiesToUpsert) {
        const affected = await executeAdaptiveUpsert(
          conn,
          "sub_activities",
          buildSubActivityCandidateRow({ ...sa, programId }, nowIso)
        );
        totalAffectedRows += affected;
      }
    }
    if (auditLog && auditLog.id) {
      currentStage = "AUDIT LOG INSERT";
      currentTable = "audit_logs";
      const affected = await executeAdaptiveUpsert(
        conn,
        "audit_logs",
        buildAuditLogCandidateRow(auditLog, nowIso)
      );
      totalAffectedRows += affected;
    }
    currentStage = "COMMIT";
    await conn.commit();
    console.log(
      `[IMPORT] COMMIT SUCCESS (programId=${programId}, outcomes=${outcomesToUpsert.length}, outputs=${outputsToUpsert.length}, activities=${activitiesToUpsert.length}, subActivities=${subActivitiesToUpsert.length}, affectedRows=${totalAffectedRows})`
    );
    return { totalAffectedRows };
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
    }
    if (err && typeof err === "object") {
      err.failedTable = err.failedTable || currentTable;
      err.failedStage = err.failedStage || currentStage;
      err.failedOperation = "IMPORT_TRANSACTION";
    }
    const safeCode = err?.code ? ` [${err.code}]` : "";
    const safeMsg = String(err?.message || err || "Unknown SQL error").replace(/mysql2?:\/\/[^\s@]+@/gi, "mysql://***@").replace(/(password\s*[=:]\s*)([^\s,;]+)/gi, "$1***");
    console.error(
      `[IMPORT] TRANSACTION ROLLBACK (stage=${currentStage}, table=${currentTable})${safeCode}: ${safeMsg}`
    );
    throw err;
  } finally {
    conn.release();
  }
}
async function saveDatabaseToMysql(pool, data) {
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
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
      if (v === void 0) continue;
      await executeAdaptiveUpsert(
        conn,
        "system_kv_store",
        {
          store_key: k.slice(0, 128),
          store_value: JSON.stringify(v),
          updated_at: nowIso
        },
        {
          primaryKeyColumn: "store_key",
          immutableOnUpdateColumns: []
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

// src/server/integratedSeedData.ts
var SEED_PROGRAMS = [
  {
    id: "prog-wijna-01",
    name: "PRJ3581 Organizational Strengthening and Operational Support for WIJNA to accompany MCC partners and to implement the GSL Program in Indonesia.",
    code: "PRJ3581",
    location: "Kabupaten Demak, Kabupaten Pekalongan & Kota Semarang, Jawa Tengah",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    description: "Organizational Strengthening and Operational Support for WIJNA to accompany MCC partners and to implement the GSL Program in Indonesia (1 April 2026 \u2013 31 Maret 2027).",
    folderUrl: "https://drive.google.com/drive/folders/wijna-prj3581-2026",
    picId: "",
    picName: "",
    status: "Aktif",
    createdAt: "2026-04-01T08:00:00Z",
    updatedAt: "2026-10-15T10:30:00Z"
  }
];
var SEED_OUTCOMES = [
  {
    id: "outc-srw-1",
    programId: "prog-wijna-01",
    programName: "PRJ3581 Organizational Strengthening and Operational Support for WIJNA to accompany MCC partners and to implement the GSL Program in Indonesia.",
    outcomeNumber: "Outcome 1",
    name: "Outcome 1: WIJNA has increased its organization structure, Governance and Operational Capacity.",
    description: "WIJNA has increased its organization structure, Governance and Operational Capacity.",
    picId: "",
    picName: "",
    projectName: "PRJ3581 Organizational Strengthening and Operational Support for WIJNA to accompany MCC partners and to implement the GSL Program in Indonesia.",
    status: "Sedang Berjalan",
    indicators: [
      {
        id: "ind-outc-srw-1a",
        name: "WIJNA has expanded its organizational structure and strengthened its governance through clearer roles, updated policies, and increased board engagement.",
        description: "WIJNA board minutes, board resolutions/memoranda, approved institutional policies, and strategic planning documents and organizational sustainability strategy.",
        dataSource: "WIJNA board minutes, board resolutions/memoranda, approved institutional policies, and strategic planning documents and organizational sustainability strategy.",
        cumulativeType: "Cumulative",
        plannedDataBreakdown: "1 board minutes & 1 board resolution each year ; 10 policies by the end of project ; 6 board member (3 M & 3 F) ; 6 Wijna's staff (3M & 3F)",
        reportingFrequency: "Annual",
        baseline: "TBA",
        target: `WIJNA has strengthened its organizational governance and developed robust policies to support its sustainability goals. The board has demonstrated strong engagement in enhancing WIJNA's capacity, building its independence, and identifying opportunities to access additional funding to ensure sustainability."`,
        endOfProjectGoal: `WIJNA has strengthened its organizational governance and developed robust policies to support its sustainability goals. The board has demonstrated strong engagement in enhancing WIJNA's capacity, building its independence, and identifying opportunities to access additional funding to ensure sustainability."`,
        unit: "Dokumen & Kebijakan",
        verificationMethod: "WIJNA board minutes, board resolutions/memoranda, approved institutional policies, and strategic planning documents and organizational sustainability strategy."
      }
    ],
    createdAt: "2026-01-08T08:00:00Z"
  },
  {
    id: "outc-srw-2",
    programId: "prog-wijna-01",
    programName: "PRJ3581 Organizational Strengthening and Operational Support for WIJNA to accompany MCC partners and to implement the GSL Program in Indonesia.",
    outcomeNumber: "Outcome 2",
    name: "Outcome 2: WIJNA has increased its capacity to access grants beyond MCC",
    description: "WIJNA has increased its capacity to access grants beyond MCC",
    picId: "",
    picName: "",
    projectName: "PRJ3581 Organizational Strengthening and Operational Support for WIJNA to accompany MCC partners and to implement the GSL Program in Indonesia.",
    status: "Sedang Berjalan",
    indicators: [
      {
        id: "ind-outc-srw-2a",
        name: "# of staff trained in grant writing and donor compliance.",
        description: "Training certificate, and pre and post test, training reports",
        dataSource: "Training certificate, and pre and post test, training reports",
        cumulativeType: "Non cumulative",
        plannedDataBreakdown: "3 staff (2M 1F)",
        reportingFrequency: "Annual",
        baseline: "TBA",
        target: "3 staffs trained in grant writing and donor compliance.",
        endOfProjectGoal: "3 staffs trained in grant writing and donor compliance.",
        unit: "Staff",
        verificationMethod: "Training certificate, and pre and post test, training reports"
      },
      {
        id: "ind-outc-srw-2b",
        name: "# of new donor engagements or partnerships established.",
        description: "Partnership agreement, colaboration agreement",
        dataSource: "Partnership agreement, colaboration agreement",
        cumulativeType: "Non cumulative",
        plannedDataBreakdown: "3 new donors or partners by WIJNA staff (2M 3F)",
        reportingFrequency: "Annual",
        baseline: "TBA",
        target: "at least 3 new donor engagements or partnerships established.",
        endOfProjectGoal: "at least 3 new donor engagements or partnerships established.",
        unit: "Partnerships",
        verificationMethod: "Partnership agreement, colaboration agreement"
      },
      {
        id: "ind-outc-srw-2c",
        name: "# of grant proposals submitted to non-MCC donors.",
        description: "Proposal submited",
        dataSource: "Proposal submited",
        cumulativeType: "Non cumulative",
        plannedDataBreakdown: "2 grant proposal by WIJNA staff (2M 3F)",
        reportingFrequency: "Annual",
        baseline: "TBA",
        target: "at least 2 grant proposals submitted to non-MCC donors.",
        endOfProjectGoal: "at least 2 grant proposals submitted to non-MCC donors.",
        unit: "Proposals",
        verificationMethod: "Proposal submited"
      },
      {
        id: "ind-outc-srw-2d",
        name: "# of successful grants awarded from new funding sources.",
        description: "Award letter, and project contract",
        dataSource: "Award letter, and project contract",
        cumulativeType: "Non cumulative",
        plannedDataBreakdown: "2 awards",
        reportingFrequency: "Annual",
        baseline: "TBA",
        target: "at least 2 successful grants awarded from new funding sources.",
        endOfProjectGoal: "at least 2 successful grants awarded from new funding sources.",
        unit: "Awards",
        verificationMethod: "Award letter, and project contract"
      }
    ],
    createdAt: "2026-01-09T08:00:00Z"
  },
  {
    id: "outc-srw-3",
    programId: "prog-wijna-01",
    programName: "PRJ3581 Organizational Strengthening and Operational Support for WIJNA to accompany MCC partners and to implement the GSL Program in Indonesia.",
    outcomeNumber: "Outcome 3",
    name: "Outcome 3: Enhanced accompaniment and technical support delivered to implementing partners in Indonesia to strengthen program quality and effectiveness.",
    description: "Enhanced accompaniment and technical support delivered to implementing partners in Indonesia to strengthen program quality and effectiveness.",
    picId: "",
    picName: "",
    projectName: "PRJ3581 Organizational Strengthening and Operational Support for WIJNA to accompany MCC partners and to implement the GSL Program in Indonesia.",
    status: "Sedang Berjalan",
    indicators: [
      {
        id: "ind-outc-srw-3a",
        name: "# of accompaniment and technical support sessions conducted with implementing partners.",
        description: "Technical support report, attendance",
        dataSource: "Technical support report, attendance",
        cumulativeType: "Cumulative",
        plannedDataBreakdown: "6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female)",
        reportingFrequency: "Semi-annual",
        baseline: "TBA",
        target: "at least 20 accompaniment and technical support sessions conducted with implementing partners each year",
        endOfProjectGoal: "at least 20 accompaniment and technical support sessions conducted with implementing partners each year",
        unit: "Sessions",
        verificationMethod: "Technical support report, attendance"
      },
      {
        id: "ind-outc-srw-3b",
        name: "% of implementing partners reporting improved capacity due to accompaniment support.",
        description: "Partner feedback form, and partner implementation performance",
        dataSource: "Partner feedback form, and partner implementation performance",
        cumulativeType: "Cumulative",
        plannedDataBreakdown: "6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female)",
        reportingFrequency: "Semi-annual",
        baseline: "TBA",
        target: "at least 90% of implementing partners reporting improved capacity due to accompaniment support.",
        endOfProjectGoal: "at least 90% of implementing partners reporting improved capacity due to accompaniment support.",
        unit: "Persen (%)",
        verificationMethod: "Partner feedback form, and partner implementation performance"
      },
      {
        id: "ind-outc-srw-3c",
        name: "% of implementing partners meeting MCC program quality standards after receiving support.",
        description: "MCC feedback to implementing partner",
        dataSource: "MCC feedback to implementing partner",
        cumulativeType: "Cumulative",
        plannedDataBreakdown: "6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female)",
        reportingFrequency: "Semi-annual",
        baseline: "TBA",
        target: "at least 90% of implementing partners meeting MCC program quality standards after receiving support.",
        endOfProjectGoal: "at least 90% of implementing partners meeting MCC program quality standards after receiving support.",
        unit: "Persen (%)",
        verificationMethod: "MCC feedback to implementing partner"
      }
    ],
    createdAt: "2026-01-09T09:00:00Z"
  },
  {
    id: "outc-srw-4",
    programId: "prog-wijna-01",
    programName: "PRJ3581 Organizational Strengthening and Operational Support for WIJNA to accompany MCC partners and to implement the GSL Program in Indonesia.",
    outcomeNumber: "Outcome 4",
    name: "Outcome 4: Improved implementation quality and impact of Global Service Learning (GSL) Program co-implemented by WIJNA and MCC",
    description: "Improved implementation quality and impact of Global Service Learning (GSL) Program co-implemented by WIJNA and MCC",
    picId: "",
    picName: "",
    projectName: "PRJ3581 Organizational Strengthening and Operational Support for WIJNA to accompany MCC partners and to implement the GSL Program in Indonesia.",
    status: "Sedang Berjalan",
    indicators: [
      {
        id: "ind-outc-srw-4a",
        name: "% of participants reporting a meaningful experience as GSL participants serving in Indonesia.",
        description: "Participant feedback form and reflection document",
        dataSource: "Participant feedback form and reflection document",
        cumulativeType: "Cumulative",
        plannedDataBreakdown: "24 GSL participant (12 sent and 12 recived) (12 M 12F)",
        reportingFrequency: "Annual",
        baseline: "TBA",
        target: "100 % of participants reporting a meaningful experience as GSL participants serving in Indonesia.",
        endOfProjectGoal: "100 % of participants reporting a meaningful experience as GSL participants serving in Indonesia.",
        unit: "Persen (%)",
        verificationMethod: "Participant feedback form and reflection document"
      },
      {
        id: "ind-outc-srw-4b",
        name: "# of Indonesian participants successfully recruited into the GSL Program and placed in other countries.",
        description: "Official placement document or official invitation from MCC (Signed ROA)",
        dataSource: "Official placement document or official invitation from MCC (Signed ROA)",
        cumulativeType: "Cumulative",
        plannedDataBreakdown: "12 GSL participants (6M 6F)",
        reportingFrequency: "Annual",
        baseline: "TBA",
        target: "12 Indonesian participants successfully recruited into the GSL Program and placed in other countries.",
        endOfProjectGoal: "12 Indonesian participants successfully recruited into the GSL Program and placed in other countries.",
        unit: "Participants",
        verificationMethod: "Official placement document or official invitation from MCC (Signed ROA)"
      }
    ],
    createdAt: "2026-01-09T10:00:00Z"
  },
  {
    id: "outc-srw-5",
    programId: "prog-wijna-01",
    programName: "PRJ3581 Organizational Strengthening and Operational Support for WIJNA to accompany MCC partners and to implement the GSL Program in Indonesia.",
    outcomeNumber: "Outcome 5",
    name: "Outcome 5: Improve strategic engagement between MCC and Mennonite and Papua Synod",
    description: "Improve strategic engagement between MCC and Mennonite and Papua Synod",
    picId: "",
    picName: "",
    projectName: "PRJ3581 Organizational Strengthening and Operational Support for WIJNA to accompany MCC partners and to implement the GSL Program in Indonesia.",
    status: "Sedang Berjalan",
    indicators: [
      {
        id: "ind-outc-srw-5a",
        name: "# of meetings, consultations, or coordination sessions facilitated by Wijna between MCC and the Mennonite and Papua synods",
        description: "Activity report, attendance, documentation",
        dataSource: "Activity report, attendance, documentation",
        cumulativeType: "Cumulative",
        plannedDataBreakdown: "2 MCC representatives (male and female), 6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female), 6 persons from Synods (3 male & 3 female)",
        reportingFrequency: "Semi-annual",
        baseline: "TBA",
        target: "6 meetings, consultations, or coordination sessions facilitated by Wijna between MCC and the Mennonite and Papua synods",
        endOfProjectGoal: "6 meetings, consultations, or coordination sessions facilitated by Wijna between MCC and the Mennonite and Papua synods",
        unit: "Sessions",
        verificationMethod: "Activity report, attendance, documentation"
      }
    ],
    createdAt: "2026-01-09T11:00:00Z"
  }
];
var SEED_OUTPUTS = [
  {
    id: "outp-srw-1-1",
    outcomeId: "outc-srw-1",
    outputNumber: "Output 1.1",
    name: "Output 1.1: Conduct regular board meeting",
    description: "Conduct regular board meeting",
    picId: "",
    picName: "",
    status: "Sedang Berjalan",
    indicators: [
      {
        id: "ind-outp-srw-1-1a",
        name: "# of regular Board meetings conducted according to the approved governance schedule",
        description: "Board minutes and attendance",
        dataSource: "Board minutes and attendance",
        cumulativeType: "Non cumulative",
        plannedDataBreakdown: "3 Board' minutes and 3 attendance list ; 6 board member (3 M & 3 F) ; 6 Wijna's staff (3M & 3F)",
        reportingFrequency: "Annual",
        baseline: "TBA",
        target: "Three board meetings are conducted over the project period, at a rate of one per year from 2026 to 2028.",
        endOfProjectGoal: "Three board meetings are conducted over the project period, at a rate of one per year from 2026 to 2028.",
        unit: "Meetings",
        verificationMethod: "Board minutes and attendance"
      }
    ],
    createdAt: "2026-01-10T08:00:00Z"
  },
  {
    id: "outp-srw-1-2",
    outcomeId: "outc-srw-1",
    outputNumber: "Output 1.2",
    name: "Output 1.2: Organizational policies are developed, updated, and approved by the Board.",
    description: "Organizational policies are developed, updated, and approved by the Board.",
    picId: "",
    picName: "",
    status: "Sedang Berjalan",
    indicators: [
      {
        id: "ind-outp-srw-1-2a",
        name: "% of organizational policies developed/updated and approved by the Board.",
        description: "Policies develop, improved and approved by the Board",
        dataSource: "Policies develop, improved and approved by the Board",
        cumulativeType: "Non cumulative",
        plannedDataBreakdown: "10 policies by the end of project",
        reportingFrequency: "Annual",
        baseline: "TBA",
        target: "100% of the organizational policies prioritized in the project are developed/updated and formally approved by the Board by the end of the project.",
        endOfProjectGoal: "100% of the organizational policies prioritized in the project are developed/updated and formally approved by the Board by the end of the project.",
        unit: "Persen (%)",
        verificationMethod: "Policies develop, improved and approved by the Board"
      }
    ],
    createdAt: "2026-01-10T09:00:00Z"
  },
  {
    id: "outp-srw-1-3",
    outcomeId: "outc-srw-1",
    outputNumber: "Output 1.3",
    name: "Output 1.3: Key staff positions are filled with qualified and competent personnel, with staff retention maintained.",
    description: "Key staff positions are filled with qualified and competent personnel, with staff retention maintained.",
    picId: "",
    picName: "",
    status: "Sedang Berjalan",
    indicators: [
      {
        id: "ind-outp-srw-1-3a",
        name: "% of key staff positions filled; retention rate at 90%.",
        description: "Staff JD, and contract, updated organizational chart",
        dataSource: "Staff JD, and contract, updated organizational chart",
        cumulativeType: "Non cumulative",
        plannedDataBreakdown: "6 WIJNA staff (3M 3F) & the 3rd year recruited 2 new staffs (1M 1F)",
        reportingFrequency: "Annual",
        baseline: "TBA",
        target: "100% key staff positions are filled with qualified and competent personnel, and overall staff retention is maintained at least 90%",
        endOfProjectGoal: "100% key staff positions are filled with qualified and competent personnel, and overall staff retention is maintained at least 90%",
        unit: "Persen (%)",
        verificationMethod: "Staff JD, and contract, updated organizational chart"
      }
    ],
    createdAt: "2026-01-10T09:30:00Z"
  },
  {
    id: "outp-srw-1-4",
    outcomeId: "outc-srw-1",
    outputNumber: "Output 1.4",
    name: "Output 1.4: Staff receive development training that enhances their skills and improves overall institutional effectiveness.",
    description: "Staff receive development training that enhances their skills and improves overall institutional effectiveness.",
    picId: "",
    picName: "",
    status: "Sedang Berjalan",
    indicators: [
      {
        id: "ind-outp-srw-1-4a",
        name: "% of staff who complete development training aligned with institutional capacity needs.",
        description: "Training certificate, and pre and post test, training reports",
        dataSource: "Training certificate, and pre and post test, training reports",
        cumulativeType: "Cumulative",
        plannedDataBreakdown: "3 staff (2M 1F)",
        reportingFrequency: "Semi-annual",
        baseline: "TBA",
        target: "at least 80% of staff have completed development training that is aligned with institutional capacity needs.",
        endOfProjectGoal: "at least 80% of staff have completed development training that is aligned with institutional capacity needs.",
        unit: "Persen (%)",
        verificationMethod: "Training certificate, and pre and post test, training reports"
      }
    ],
    createdAt: "2026-01-10T10:00:00Z"
  },
  {
    id: "outp-srw-2-1",
    outcomeId: "outc-srw-2",
    outputNumber: "Output 2.1",
    name: "Output 2.1: Donor networking activities strengthened to expand engagement and partnership opportunities.",
    description: "Donor networking activities strengthened to expand engagement and partnership opportunities.",
    picId: "",
    picName: "",
    status: "Sedang Berjalan",
    indicators: [
      {
        id: "ind-outp-srw-2-1a",
        name: "# of new or strengthened donor relationships established through networking activities.",
        description: "Activity report",
        dataSource: "Activity report",
        cumulativeType: "Non cumulative",
        plannedDataBreakdown: "3 new donors or partners by WIJNA staff (2M 3F)",
        reportingFrequency: "Semi-annual",
        baseline: "TBA",
        target: "at least 3 new or strengthened donor relationships have been established through WIJNA\u2019s networking activities.",
        endOfProjectGoal: "at least 3 new or strengthened donor relationships have been established through WIJNA\u2019s networking activities.",
        unit: "Donor Relationships",
        verificationMethod: "Activity report"
      }
    ],
    createdAt: "2026-01-11T08:00:00Z"
  },
  {
    id: "outp-srw-2-2",
    outcomeId: "outc-srw-2",
    outputNumber: "Output 2.2",
    name: "Output 2.2: Relevant WIJNA staff trained in grants management and proposal development.",
    description: "Relevant WIJNA staff trained in grants management and proposal development.",
    picId: "",
    picName: "",
    status: "Sedang Berjalan",
    indicators: [
      {
        id: "ind-outp-srw-2-2a",
        name: "# of WIJNA staff who completed training in grants management and proposal development.",
        description: "Training certificate, and pre and post test, training reports",
        dataSource: "Training certificate, and pre and post test, training reports",
        cumulativeType: "Non cumulative",
        plannedDataBreakdown: "3 staff (2M 1F)",
        reportingFrequency: "Annual",
        baseline: "TBA",
        target: "3 WIJNA staff who completed training in grants management and proposal development.",
        endOfProjectGoal: "3 WIJNA staff who completed training in grants management and proposal development.",
        unit: "Staff",
        verificationMethod: "Training certificate, and pre and post test, training reports"
      }
    ],
    createdAt: "2026-01-11T08:30:00Z"
  },
  {
    id: "outp-srw-2-3",
    outcomeId: "outc-srw-2",
    outputNumber: "Output 2.3",
    name: "Output 2.3: Project proposals are developed and submitted to potential funding sources.",
    description: "Project proposals are developed and submitted to potential funding sources.",
    picId: "",
    picName: "",
    status: "Sedang Berjalan",
    indicators: [
      {
        id: "ind-outp-srw-2-3a",
        name: "# of project proposals developed and submitted to potential funding sources",
        description: "Proposal submited",
        dataSource: "Proposal submited",
        cumulativeType: "Cumulative",
        plannedDataBreakdown: "2 project proposal by WIJNA staff (2M 3F)",
        reportingFrequency: "Annual",
        baseline: "TBA",
        target: "2 project proposals developed and submitted to potential funding sources",
        endOfProjectGoal: "2 project proposals developed and submitted to potential funding sources",
        unit: "Project Proposals",
        verificationMethod: "Proposal submited"
      }
    ],
    createdAt: "2026-01-11T09:00:00Z"
  },
  {
    id: "outp-srw-3-1",
    outcomeId: "outc-srw-3",
    outputNumber: "Output 3.1",
    name: "Output 3.1: Partner assessments conducted to evaluate appropriateness, capacity, safeguarding, and financial alignment with MCC standards.",
    description: "Partner assessments conducted to evaluate appropriateness, capacity, safeguarding, and financial alignment with MCC standards.",
    picId: "",
    picName: "",
    status: "Sedang Berjalan",
    indicators: [
      {
        id: "ind-outp-srw-3-1a",
        name: "# of partner assessments completed according to MCC standards.",
        description: "Actual partner assessments",
        dataSource: "Actual partner assessments",
        cumulativeType: "Cumulative",
        plannedDataBreakdown: "2 partner assesment ; 6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female)",
        reportingFrequency: "Semi-annual",
        baseline: "TBA",
        target: "2 partner assessments completed according to MCC standards.",
        endOfProjectGoal: "2 partner assessments completed according to MCC standards.",
        unit: "Assessments",
        verificationMethod: "Actual partner assessments"
      }
    ],
    createdAt: "2026-01-12T08:00:00Z"
  },
  {
    id: "outp-srw-3-2",
    outcomeId: "outc-srw-3",
    outputNumber: "Output 3.2",
    name: "Output 3.2: Partners receive technical support in project planning, implementation, reporting, and monitoring to ensure quality and effectiveness.",
    description: "Partners receive technical support in project planning, implementation, reporting, and monitoring to ensure quality and effectiveness.",
    picId: "",
    picName: "",
    status: "Sedang Berjalan",
    indicators: [
      {
        id: "ind-outp-srw-3-2a",
        name: "# of partners receiving technical support in project planning, implementation, reporting, or monitoring.",
        description: "Improve report, proposal, CN development, submited human intrest stories, and quality documentation",
        dataSource: "Improve report, proposal, CN development, submited human intrest stories, and quality documentation",
        cumulativeType: "Cumulative",
        plannedDataBreakdown: "2 partner ; 6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female)",
        reportingFrequency: "Semi-annual",
        baseline: "TBA",
        target: "2 partners receiving technical support in project planning, implementation, reporting, or monitoring.",
        endOfProjectGoal: "2 partners receiving technical support in project planning, implementation, reporting, or monitoring.",
        unit: "Partners",
        verificationMethod: "Improve report, proposal, CN development, submited human intrest stories, and quality documentation"
      }
    ],
    createdAt: "2026-01-12T08:30:00Z"
  },
  {
    id: "outp-srw-3-3",
    outcomeId: "outc-srw-3",
    outputNumber: "Output 3.3",
    name: "Output 3.3: Conduct orientations and training to strengthen partners' capacity for compliance with MCC standards and guidance.",
    description: "Conduct orientations and training to strengthen partners' capacity for compliance with MCC standards and guidance.",
    picId: "",
    picName: "",
    status: "Sedang Berjalan",
    indicators: [
      {
        id: "ind-outp-srw-3-3a",
        name: "# of partners receiving orientations and trainings on MCC standards and guidance.",
        description: "Training report, attendance",
        dataSource: "Training report, attendance",
        cumulativeType: "Cumulative",
        plannedDataBreakdown: "2 partner ; 6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female)",
        reportingFrequency: "Semi-annual",
        baseline: "TBA",
        target: "2 partners receiving orientations and trainings on MCC standards and guidance.",
        endOfProjectGoal: "2 partners receiving orientations and trainings on MCC standards and guidance.",
        unit: "Partners",
        verificationMethod: "Training report, attendance"
      }
    ],
    createdAt: "2026-01-12T09:00:00Z"
  },
  {
    id: "outp-srw-3-4",
    outcomeId: "outc-srw-3",
    outputNumber: "Output 3.4",
    name: "Output 3.4: Partners' peacebuilding skills and knowledge enhanced through MPI participation.",
    description: "Partners' peacebuilding skills and knowledge enhanced through MPI participation.",
    picId: "",
    picName: "",
    status: "Sedang Berjalan",
    indicators: [
      {
        id: "ind-outp-srw-3-4a",
        name: "# of partners participating in the Mindanao Peacebuilding Institute (MPI)",
        description: "Training completion certificate from MPI, participant reflection",
        dataSource: "Training completion certificate from MPI, participant reflection",
        cumulativeType: "Cumulative",
        plannedDataBreakdown: "2 person (1M ; 1F)",
        reportingFrequency: "Semi-annual",
        baseline: "TBA",
        target: "at least 2 person from WIJNA's partners participating in the Mindanao Peacebuilding Institute (MPI) each year",
        endOfProjectGoal: "at least 2 person from WIJNA's partners participating in the Mindanao Peacebuilding Institute (MPI) each year",
        unit: "Persons",
        verificationMethod: "Training completion certificate from MPI, participant reflection"
      }
    ],
    createdAt: "2026-01-12T09:30:00Z"
  },
  {
    id: "outp-srw-3-5",
    outcomeId: "outc-srw-3",
    outputNumber: "Output 3.5",
    name: "Output 3.5: Annual partner gatherings and learning events conducted to foster collaboration and knowledge exchange",
    description: "Annual partner gatherings and learning events conducted to foster collaboration and knowledge exchange",
    picId: "",
    picName: "",
    status: "Sedang Berjalan",
    indicators: [
      {
        id: "ind-outp-srw-3-5a",
        name: "# of partner gatherings and learning events conducted annually.",
        description: "Activity Report and documentation",
        dataSource: "Activity Report and documentation",
        cumulativeType: "Cumulative",
        plannedDataBreakdown: "20 staff of partners (10 female and 10 male), 2 Wijna Board members (1 male and 1 female)",
        reportingFrequency: "Semi-annual",
        baseline: "TBA",
        target: "1 time partner gatherings and learning events conducted annually.",
        endOfProjectGoal: "1 time partner gatherings and learning events conducted annually.",
        unit: "Events",
        verificationMethod: "Activity Report and documentation"
      }
    ],
    createdAt: "2026-01-12T10:00:00Z"
  },
  {
    id: "outp-srw-3-6",
    outcomeId: "outc-srw-3",
    outputNumber: "Output 3.6",
    name: "Output 3.6: Regular monitoring and evaluation activities conducted to track project progress and outcomes (baseline and endline)",
    description: "Regular monitoring and evaluation activities conducted to track project progress and outcomes (baseline and endline)",
    picId: "",
    picName: "",
    status: "Sedang Berjalan",
    indicators: [
      {
        id: "ind-outp-srw-3-6a",
        name: "# of monitoring and evaluation activities conducted",
        description: "Monitoring and evalution report, baseline report",
        dataSource: "Monitoring and evalution report, baseline report",
        cumulativeType: "Cumulative",
        plannedDataBreakdown: "2 partner ; 6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female)",
        reportingFrequency: "Semi-annual",
        baseline: "TBA",
        target: "at least 20 monitoring and evaluation activities conducted annualy",
        endOfProjectGoal: "at least 20 monitoring and evaluation activities conducted annualy",
        unit: "Activities",
        verificationMethod: "Monitoring and evalution report, baseline report"
      }
    ],
    createdAt: "2026-01-12T10:30:00Z"
  },
  {
    id: "outp-srw-4-1",
    outcomeId: "outc-srw-4",
    outputNumber: "Output 4.1",
    name: "Output 4.1: Indonesian GSL participants are recruited, selected, and vetted.",
    description: "Indonesian GSL participants are recruited, selected, and vetted.",
    picId: "",
    picName: "",
    status: "Sedang Berjalan",
    indicators: [
      {
        id: "ind-outp-srw-4-1a",
        name: "# of Indonesian participants successfully recruited, selected, and vetted.",
        description: "Official placement document or official invitation from MCC",
        dataSource: "Official placement document or official invitation from MCC",
        cumulativeType: "Cumulative",
        plannedDataBreakdown: "12 GSL participants (6M 6F)",
        reportingFrequency: "Semi-annual",
        baseline: "TBA",
        target: "12 Indonesian participants successfully recruited, selected, and vetted.",
        endOfProjectGoal: "12 Indonesian participants successfully recruited, selected, and vetted.",
        unit: "Participants",
        verificationMethod: "Official placement document or official invitation from MCC"
      }
    ],
    createdAt: "2026-01-13T08:00:00Z"
  },
  {
    id: "outp-srw-4-2",
    outcomeId: "outc-srw-4",
    outputNumber: "Output 4.2",
    name: "Output 4.2: Indonesian GSL participants deployed in Indonesia are supported through coordination, monitoring, and logistics.",
    description: "Indonesian GSL participants deployed in Indonesia are supported through coordination, monitoring, and logistics.",
    picId: "",
    picName: "",
    status: "Sedang Berjalan",
    indicators: [
      {
        id: "ind-outp-srw-4-2a",
        name: "# of participants receiving coordination, monitoring, and logistic support.",
        description: "visa payment document, language training document, activity reports",
        dataSource: "visa payment document, language training document, activity reports",
        cumulativeType: "Cumulative",
        plannedDataBreakdown: "12 GSL participants (6M 6F)",
        reportingFrequency: "Semi-annual",
        baseline: "TBA",
        target: "12 participants receiving coordination, monitoring, and logistic support.",
        endOfProjectGoal: "12 participants receiving coordination, monitoring, and logistic support.",
        unit: "Participants",
        verificationMethod: "visa payment document, language training document, activity reports"
      }
    ],
    createdAt: "2026-01-13T08:30:00Z"
  },
  {
    id: "outp-srw-4-3",
    outcomeId: "outc-srw-4",
    outputNumber: "Output 4.3",
    name: "Output 4.3: Placements and host families are developed and prepared to support the Indonesia GSL Program.",
    description: "Placements and host families are developed and prepared to support the Indonesia GSL Program.",
    picId: "",
    picName: "",
    status: "Sedang Berjalan",
    indicators: [
      {
        id: "ind-outp-srw-4-3a",
        name: "# of placements and host families developed and prepared.",
        description: "List of placement and host families",
        dataSource: "List of placement and host families",
        cumulativeType: "Cumulative",
        plannedDataBreakdown: "12 host family-household (12 male 12 female)",
        reportingFrequency: "Semi-annual",
        baseline: "TBA",
        target: "12 placements and 12 host families developed and prepared.",
        endOfProjectGoal: "12 placements and 12 host families developed and prepared.",
        unit: "Placements & Host Families",
        verificationMethod: "List of placement and host families"
      }
    ],
    createdAt: "2026-01-13T09:00:00Z"
  },
  {
    id: "outp-srw-4-4",
    outcomeId: "outc-srw-4",
    outputNumber: "Output 4.4",
    name: "Output 4.4: Related activities are conducted to support the GSL Program.",
    description: "Related activities are conducted to support the GSL Program.",
    picId: "",
    picName: "",
    status: "Sedang Berjalan",
    indicators: [
      {
        id: "ind-outp-srw-4-4a",
        name: "# of GSL support activities implemented.",
        description: "Activity report, attendance",
        dataSource: "Activity report, attendance",
        cumulativeType: "Cumulative",
        plannedDataBreakdown: "12 host family-household (12 male 12 female) 20 alumni (10 male 10 female)",
        reportingFrequency: "Semi-annual",
        baseline: "TBA",
        target: "12 GSL support activities implemented.",
        endOfProjectGoal: "12 GSL support activities implemented.",
        unit: "Activities",
        verificationMethod: "Activity report, attendance"
      }
    ],
    createdAt: "2026-01-13T09:30:00Z"
  },
  {
    id: "outp-srw-5-1",
    outcomeId: "outc-srw-5",
    outputNumber: "Output 5.1",
    name: "Output 5.1: Strengthened engagement and relationships between MCC and the Mennonite and Papua synods through networking and coordination support",
    description: "Strengthened engagement and relationships between MCC and the Mennonite and Papua synods through networking and coordination support",
    picId: "",
    picName: "",
    status: "Sedang Berjalan",
    indicators: [
      {
        id: "ind-outp-srw-5-1a",
        name: "# of meetings, consultations, or coordination sessions facilitated by Wijna between MCC and the Mennonite and Papua synods",
        description: "Activity report, attendance, documentation",
        dataSource: "Activity report, attendance, documentation",
        cumulativeType: "Cumulative",
        plannedDataBreakdown: "2 MCC representatives (male and female), 6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female), 6 persons from Synods (3 male & 3 female)",
        reportingFrequency: "Semi-annual",
        baseline: "TBA",
        target: "6 meetings, consultations, or coordination sessions facilitated by Wijna between MCC and the Mennonite and Papua synods",
        endOfProjectGoal: "6 meetings, consultations, or coordination sessions facilitated by Wijna between MCC and the Mennonite and Papua synods",
        unit: "Sessions",
        verificationMethod: "Activity report, attendance, documentation"
      }
    ],
    createdAt: "2026-01-14T08:00:00Z"
  }
];
var SEED_ACTIVITIES = [
  {
    id: "act-srw-1-1-1",
    outputId: "outp-srw-1-1",
    activityNumber: "Activity 1.1",
    code: "1.1.1",
    name: "Activity 1.1 Conduct regular Board meetings to ensure accountability, effective governance and decision-making.",
    description: "Regular board meetings will be conducted once a year. During these meetings, WIJNA will present the organization\u2019s financial status and key accomplishments within the period. Important decisions will be made, and policies reviewed and approved. Key discussions on WIJNA\u2019s sustainability, challenges, and opportunities will be held, and appropriate plans for execution by the WIJNA team will be developed.",
    anticipatedInputs: "Venue, transportation, key documents, documenter",
    plannedParticipantsBreakdown: "6 board member (3 male and 3 female) and 6 Wijna staff (3 male and 3 female)",
    picId: "",
    picName: "",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    status: "Sedang Berjalan",
    createdAt: "2026-01-12T08:00:00Z"
  },
  {
    id: "act-srw-1-2-1",
    outputId: "outp-srw-1-2",
    activityNumber: "Activity 1.2",
    code: "1.2.1",
    name: "Activity 1.2 Develop and update organizational policies and procedures to strengthen institutional systems and compliance.",
    description: "WIJNA will develop and maintain its core organizational policies and conduct periodic updates to the supporting SOPs in strategic areas such as Safeguarding & PSEAH, Data Protection & Digital Security, Anti-Fraud and Anti-Corruption, Financial Integrity, MEAL, Climate & Environmental Risk, Security & Field Safety, Partnership & Local Coordination, HR, Communication & Ethical Media, and the complaint mechanism. These SOPs will be evaluated and revised annually to ensure relevance, quality, and compliance with national regulations and best-practice standards. All approved updates will be communicated to staff to ensure consistent implementation across the organization.",
    anticipatedInputs: "Policy development materials, consultant or reviewer fees, staff time, software for document management, meeting facilitation, printing and dissemination costs.",
    plannedParticipantsBreakdown: "5 Wijna staff (3 female and 2 male)",
    picId: "",
    picName: "",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    status: "Sedang Berjalan",
    createdAt: "2026-01-12T08:30:00Z"
  },
  {
    id: "act-srw-1-1-2",
    outputId: "outp-srw-1-3",
    activityNumber: "Activity 1.3",
    code: "1.3.1",
    name: "Activity 1.3 Recruit and retain qualified WIJNA staff to maintain organizational capacity and continuity.",
    description: "WIJNA will recruit two qualified staff (a Finance Officer and a Program Manager in year 3) to maintain organizational capacity as two current staff retire. A structured knowledge-transfer process will ensure continuity. Recruitment will follow transparent, competency-based standards, supported by supervision, capacity-building, and a positive work environment to retain staff.",
    anticipatedInputs: "Training venue, trainer or consultant fees, modules and training materials, transportation, meals, accommodation (if needed), monitoring tools.",
    plannedParticipantsBreakdown: "2 Wijna staff (1 male and 1 female)",
    picId: "",
    picName: "",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    status: "Sedang Berjalan",
    createdAt: "2026-01-12T09:00:00Z"
  },
  {
    id: "act-srw-1-4-1",
    outputId: "outp-srw-1-4",
    activityNumber: "Activity 1.4",
    code: "1.4.1",
    name: "Activity 1.4 Conduct staff and organizational development training to enhance skills, performance, and institutional effectiveness.",
    description: "WIJNA will implement targeted staff and organizational development trainings to strengthen skills, address capacity gaps, and ensure compliance with best-practice standards. Priority areas include program quality, safeguarding, risk management, and operational sustainability, supporting WIJNA's effectiveness and alignment with donor expectations.",
    anticipatedInputs: "Travel and transportation, accommodation, networking event fees, communication materials, documentation support.",
    plannedParticipantsBreakdown: "5 Wijna staff (3 female and 2 male)",
    picId: "",
    picName: "",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    status: "Sedang Berjalan",
    createdAt: "2026-01-12T09:30:00Z"
  },
  {
    id: "act-srw-2-1-1",
    outputId: "outp-srw-2-1",
    activityNumber: "Activity 2.1",
    code: "2.1.1",
    name: "Activity 2.1 Conduct networking activities with partners, donors, and relevant stakeholders to strengthen collaboration and WIJNA\u2019s visibility.",
    description: "WIJNA will engage in strategic networking with partners, donors, government actors, and relevant stakeholders to strengthen collaboration, expand resource opportunities, and increase WIJNA\u2019s visibility. These engagements will support partnerships for program delivery, coordination, and long-term sustainability.",
    anticipatedInputs: "Consultant fees, training venue, training materials, staff time, transportation, meals, documentation tools.",
    plannedParticipantsBreakdown: "5 Wijna staff (3 female and 2 male), 6 partners (2 male, 4 female)",
    picId: "",
    picName: "",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    status: "Sedang Berjalan",
    createdAt: "2026-01-14T08:00:00Z"
  },
  {
    id: "act-srw-2-2-1",
    outputId: "outp-srw-2-2",
    activityNumber: "Activity 2.2",
    code: "2.2.1",
    name: "Activity 2.2 Conduct grants management and proposal development training for relevant WIJNA staff to enhance fundraising capacity.",
    description: "To build stronger institutional capacity, WIJNA will contract a qualified consultant to provide structured training in grants management and proposal development. The training will equip staff with the skills needed to meet donor standards, prepare competitive proposals, and manage awarded funds responsibly and effectively.",
    anticipatedInputs: "Consultant fees, training venue, training materials, staff time, transportation, meals, documentation tools.",
    plannedParticipantsBreakdown: "3 Wijna staff (1 female and 2 male)",
    picId: "",
    picName: "",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    status: "Sedang Berjalan",
    createdAt: "2026-01-14T10:00:00Z"
  },
  {
    id: "act-srw-2-3-1",
    outputId: "outp-srw-2-3",
    activityNumber: "Activity 2.3",
    code: "2.3.1",
    name: "Activity 2.3 Develop and submit project proposals to potential funding sources to diversify and expand WIJNA\u2019s resource base.",
    description: "WIJNA will develop and submit high-quality project proposals to diverse funding sources to expand its resource base, strengthen financial sustainability, and support the organization\u2019s long-term program growth.",
    anticipatedInputs: "Consultant fees, staff time, meeting facilitation, data collection tools, communication expenses.",
    plannedParticipantsBreakdown: "3 Wijna staff (1 female and 2 male)",
    picId: "",
    picName: "",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    status: "Sedang Berjalan",
    createdAt: "2026-01-14T11:00:00Z"
  },
  {
    id: "act-srw-3-1-1",
    outputId: "outp-srw-3-1",
    activityNumber: "Activity 3.1",
    code: "3.1.1",
    name: "Activity 3.1 Conduct partner assessments to evaluate partners' partnership appropriateness, capacity building, safeguarding and financial capacity alignment with MCC accompaniment approach.",
    description: "WIJNA will conduct partner assessments to evaluate partnership suitability, organizational capacity, safeguarding practices, and financial management systems, ensuring alignment with WIJNA\u2019s accompaniment approach and standards for responsible partnership.",
    anticipatedInputs: "Assessment tools and templates, transportation, accommodation, staff time, documentation materials, communication support.",
    plannedParticipantsBreakdown: "6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female)",
    picId: "",
    picName: "",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    status: "Sedang Berjalan",
    createdAt: "2026-01-15T08:00:00Z"
  },
  {
    id: "act-srw-3-2-1",
    outputId: "outp-srw-3-2",
    activityNumber: "Activity 3.2",
    code: "3.2.1",
    name: "Activity 3.2 Provide technical support to partners in project planning, development, implementation, reporting, and monitoring to ensure quality and effectiveness.",
    description: "WIJNA will provide technical support to partners in project planning, development, implementation, reporting, and monitoring to strengthen program quality, enhance accountability, and ensure effective delivery of project outcomes.",
    anticipatedInputs: "Training and mentoring materials, facilitator time, transportation, venue (if needed), communication tools, documentation.",
    plannedParticipantsBreakdown: "6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female)",
    picId: "",
    picName: "",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    status: "Sedang Berjalan",
    createdAt: "2026-01-15T08:30:00Z"
  },
  {
    id: "act-srw-3-3-1",
    outputId: "outp-srw-3-3",
    activityNumber: "Activity 3.3",
    code: "3.3.1",
    name: "Activity 3.3 Conduct orientations and training to strengthen partners\u2019 capacity for compliance with MCC standards and guidance.",
    description: "WIJNA will conduct orientations and training to strengthen partners\u2019 capacity to comply with MCC standards and guidance, ensuring consistent quality, accountability, and alignment across all partnership activities.",
    anticipatedInputs: "Training venue, learning materials, transportation, meals, monitoring and evaluation tools.",
    plannedParticipantsBreakdown: "6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female)",
    picId: "",
    picName: "",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    status: "Sedang Berjalan",
    createdAt: "2026-01-15T09:00:00Z"
  },
  {
    id: "act-srw-3-4-1",
    outputId: "outp-srw-3-4",
    activityNumber: "Activity 3.4",
    code: "3.4.1",
    name: "Activity 3.4 Facilitate the participation of partners in the Mindanao Peacebuilding Institute (MPI) to enhance their skills and knowledge in peacebuilding.",
    description: "WIJNA will send strategically selected partner representatives to the Mindanao Peacebuilding Institute (MPI) to build the competencies of future key actors who will strengthen WIJNA\u2019s long-term peacebuilding work.",
    anticipatedInputs: "Travel, accommodation, meals, MPI tuition fees, visa processing, insurance, coordination and documentation costs.",
    plannedParticipantsBreakdown: "7 persons (4 male and 3 female)",
    picId: "",
    picName: "",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    status: "Sedang Berjalan",
    createdAt: "2026-01-15T09:30:00Z"
  },
  {
    id: "act-srw-3-5-1",
    outputId: "outp-srw-3-5",
    activityNumber: "Activity 3.5",
    code: "3.5.1",
    name: "Activity 3.5 Conduct annual partner gatherings and learning events to promote collaboration, reflection, and knowledge exchange.",
    description: "WIJNA will organize annual partner gatherings and learning events to strengthen collaboration, encourage joint reflection, and facilitate knowledge exchange that supports improved program quality and shared learning across partners.",
    anticipatedInputs: "Event venue, facilitation costs, transportation, meals, learning materials, documentation support.",
    plannedParticipantsBreakdown: "20 partners (10 female and 10 male), 2 Wijna Board members (1 male and 1 female)",
    picId: "",
    picName: "",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    status: "Sedang Berjalan",
    createdAt: "2026-01-15T10:00:00Z"
  },
  {
    id: "act-srw-3-6-1",
    outputId: "outp-srw-3-6",
    activityNumber: "Activity 3.6",
    code: "3.6.1",
    name: "Activity 3.6 Conduct regular monitoring and evaluation activities to assess project progress, outcomes, and learning.",
    description: "WIJNA will implement a strategic monitoring and learning process that includes project inception, baseline survey, financial and progress check-ins aligned with SOP, semi-annual and annual reporting, After Action Reviews, continuous monitoring of indicators and risks, an endline survey, and final reporting. All outputs will be systematically distributed to strengthen decision-making and partner coordination.",
    anticipatedInputs: "Monitoring tools, data collection instruments, staff time, transportation for site visits, meeting facilitation, reporting software.",
    plannedParticipantsBreakdown: "6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female)",
    picId: "",
    picName: "",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    status: "Sedang Berjalan",
    createdAt: "2026-01-15T10:30:00Z"
  },
  {
    id: "act-srw-4-1-1",
    outputId: "outp-srw-4-1",
    activityNumber: "Activity 4.1",
    code: "4.1.1",
    name: "Activity 4.1 Conduct recruitment selection and vetting of GSL participants from Indonesia.",
    description: "WIJNA will conduct recruitment, selection, and vetting of GSL participants, ensuring suitability, safeguarding compliance, and readiness for cross-cultural placement. WIJNA will also prepare all required visa documentation to meet program and host-country requirements, ensuring strong participant readiness in line with GSL standards.",
    anticipatedInputs: "Recruitment materials, communication costs, Visa processing fees, staff time, documentation tools, transportation for interviews.",
    plannedParticipantsBreakdown: "12 participants deployed (6 male and 6 female)",
    picId: "",
    picName: "",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    status: "Sedang Berjalan",
    createdAt: "2026-01-16T08:00:00Z"
  },
  {
    id: "act-srw-4-2-1",
    outputId: "outp-srw-4-2",
    activityNumber: "Activity 4.2",
    code: "4.2.1",
    name: "Activity 4.2 Conduct recruitment, coordination, monitoring and provision of logistic support to GSL Participants deployed in Indonesia",
    description: "WIJNA will manage the recruitment, coordination, monitoring, and logistical support of GSL participants in Indonesia, including all required visa documentation and administrative processing to ensure smooth placement and readiness.",
    anticipatedInputs: "Visa processing fees, administrative materials, transportation, accommodation support, monitoring tools, staff time.",
    plannedParticipantsBreakdown: "12 participants deployed (6 male and 6 female)",
    picId: "",
    picName: "",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    status: "Sedang Berjalan",
    createdAt: "2026-01-16T08:30:00Z"
  },
  {
    id: "act-srw-4-3-1",
    outputId: "outp-srw-4-3",
    activityNumber: "Activity 4.3",
    code: "4.3.1",
    name: "Activity 4.3 Development of placement and host families to support the Indonesia GSL Program.",
    description: "WIJNA will conduct the identification and preparation of suitable placement sites and host families, ensuring they understand and apply safeguarding requirements in accordance with MCC standards to support the Indonesia GSL Program.",
    anticipatedInputs: "Transportation for site visits, safeguarding materials, host family orientation tools, staff time, documentation.",
    plannedParticipantsBreakdown: "12 host family-household (12 male 12 female)",
    picId: "",
    picName: "",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    status: "Sedang Berjalan",
    createdAt: "2026-01-16T09:00:00Z"
  },
  {
    id: "act-srw-4-4-1",
    outputId: "outp-srw-4-4",
    activityNumber: "Activity 4.4",
    code: "4.4.1",
    name: "Activity 4.4 Conduct related activities to support the GSL Program",
    description: "WIJNA will conduct related activities to strengthen the GSL Program, including routine check-ins with participants and host families to ensure alignment and gather feedback for improvement. In addition, WIJNA will organize alumni gatherings activity to maintain connections.",
    anticipatedInputs: "Event materials, transportation for check-ins, communication costs, alumni activity facilitation, documentation tools.",
    plannedParticipantsBreakdown: "12 host family-household (12 male 12 female) 20 alumni (10 male 10 female)",
    picId: "",
    picName: "",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    status: "Sedang Berjalan",
    createdAt: "2026-01-16T09:30:00Z"
  },
  {
    id: "act-srw-5-1-1",
    outputId: "outp-srw-5-1",
    activityNumber: "Activity 5.1",
    code: "5.1.1",
    name: "Activity 5.1 Conduct networking and coordination support for MCC to strengthen its engagement and relationship with the Mennonite and Papua synod:",
    description: "WIJNA will provide networking and coordination support for MCC to strengthen its engagement and relationship with the Mennonite and Papua synod. This includes facilitating communication, arranging strategic meetings, and supporting collaborative activities that enhance mutual understanding, partnership alignment, and long-term engagement between MCC and synod leadership.",
    anticipatedInputs: "Travel and transportation, meeting facilitation, communication and documentation materials, staff time, coordination tools.",
    plannedParticipantsBreakdown: "2 MCC representatives (male and female), 6 MDS staff (4 male and 2 female), 5 STAKWW staff (3 male and 2 female), 6 persons from Synods (3 male & 3 female)",
    picId: "",
    picName: "",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    status: "Sedang Berjalan",
    createdAt: "2026-01-17T08:00:00Z"
  }
];
var SEED_SUB_ACTIVITIES = [];
var SEED_OUTPUT_RACI_RECORDS = {};
var SEED_ACTIVITY_MONITORING_RECORDS = {};
var SEED_MONITORING_REPORTS = {};
var SEED_PARTICIPANT_DATABASE = [];
var SEED_TORS = [];
var SEED_CASH_ADVANCES = [];
var SEED_MEETING_MINUTES = [];
var SEED_ACTIVITY_DOCUMENTATIONS = {};
var SEED_ACTIVITY_DOCUMENTATION_LIST = [];
var SEED_APPROVAL_RECORDS = [];
var SEED_PROGRAM_BUDGETS = {};

// src/server/db.ts
var DATA_DIR = path2.resolve(process.cwd(), "data");
var DB_FILE = path2.resolve(DATA_DIR, "db.json");
var DB_BACKUP_FILE = path2.resolve(DATA_DIR, "db.backup.json");
var INITIAL_PROGRAMS = SEED_PROGRAMS;
var INITIAL_USERS = [
  {
    id: "user-admin",
    name: "Bambang Sudiro",
    email: "admin@ngo-harmoni.org",
    role: "admin",
    roleTitle: "System Administrator",
    department: "Teknologi & Tata Kelola Sistem",
    isActive: true,
    permissions: {
      canManagePrograms: false,
      canCreateTor: false,
      canApproveTor: false,
      canManageUsers: true,
      canViewAllTors: true
    },
    createdAt: "2026-01-10T08:00:00Z"
  },
  {
    id: "user-director",
    name: "Dr. Hendra Wijaya",
    email: "director@ngo-harmoni.org",
    role: "director",
    roleTitle: "Executive Director",
    department: "Direktorat Eksekutif",
    isActive: true,
    permissions: {
      canManagePrograms: true,
      canCreateTor: true,
      canApproveTor: true,
      canManageUsers: false,
      canViewAllTors: true
    },
    createdAt: "2026-01-10T08:00:00Z"
  },
  {
    id: "user-finance",
    name: "Ratna Kusuma, S.E.",
    email: "finance@ngo-harmoni.org",
    role: "finance",
    roleTitle: "Finance & HR Manager",
    department: "Keuangan, HR & Kepatuhan",
    isActive: true,
    permissions: {
      canManagePrograms: false,
      canCreateTor: true,
      canApproveTor: true,
      canManageUsers: true,
      canViewAllTors: true
    },
    createdAt: "2026-01-12T08:00:00Z"
  },
  {
    id: "user-pm",
    name: "Dimas Pratama, M.Sc.",
    email: "pm@ngo-harmoni.org",
    role: "program_manager",
    roleTitle: "Program Manager",
    department: "Divisi Manajemen Program",
    isActive: true,
    permissions: {
      canManagePrograms: true,
      canCreateTor: true,
      canApproveTor: false,
      canManageUsers: false,
      canViewAllTors: true
    },
    createdAt: "2026-01-15T08:00:00Z"
  },
  {
    id: "user-meal",
    name: "Maya Safitri, S.Sos.",
    email: "meal@ngo-harmoni.org",
    role: "meal",
    roleTitle: "MEAL Coordinator",
    department: "Monitoring, Evaluation, Accountability & Learning",
    isActive: true,
    permissions: {
      canManagePrograms: false,
      canCreateTor: true,
      canApproveTor: false,
      canManageUsers: false,
      canViewAllTors: true
    },
    createdAt: "2026-01-18T08:00:00Z"
  },
  {
    id: "user-staff-1",
    name: "Budi Santoso",
    email: "budi.santoso@ngo-harmoni.org",
    role: "staff",
    roleTitle: "Senior Field Officer",
    department: "Operasional Lapangan",
    isActive: true,
    permissions: {
      canManagePrograms: false,
      canCreateTor: true,
      canApproveTor: false,
      canManageUsers: false,
      canViewAllTors: false
    },
    createdAt: "2026-02-01T08:00:00Z"
  },
  {
    id: "user-staff-2",
    name: "Siti Rahmawati",
    email: "siti.rahmawati@ngo-harmoni.org",
    role: "staff",
    roleTitle: "Community Facilitator",
    department: "Pemberdayaan Masyarakat",
    isActive: true,
    permissions: {
      canManagePrograms: false,
      canCreateTor: true,
      canApproveTor: false,
      canManageUsers: false,
      canViewAllTors: false
    },
    createdAt: "2026-02-05T08:00:00Z"
  }
];
var INITIAL_OUTCOMES = SEED_OUTCOMES;
var INITIAL_OUTPUTS = SEED_OUTPUTS;
var INITIAL_ACTIVITIES = SEED_ACTIVITIES;
var INITIAL_SUB_ACTIVITIES = SEED_SUB_ACTIVITIES;
var INITIAL_TORS = SEED_TORS;
var INITIAL_APPROVAL_RECORDS = SEED_APPROVAL_RECORDS;
var INITIAL_AUDIT_LOGS = [];
var INITIAL_CASH_ADVANCES = SEED_CASH_ADVANCES;
var INITIAL_ACTIVITY_DOCUMENTATIONS = SEED_ACTIVITY_DOCUMENTATIONS;
var INITIAL_ACTIVITY_DOCUMENTATION_LIST = SEED_ACTIVITY_DOCUMENTATION_LIST;
var INITIAL_MEETING_MINUTES = SEED_MEETING_MINUTES;
var INITIAL_OUTPUT_RACI_RECORDS = SEED_OUTPUT_RACI_RECORDS;
var INITIAL_ACTIVITY_MONITORING_RECORDS = SEED_ACTIVITY_MONITORING_RECORDS;
var INITIAL_MONITORING_REPORTS = SEED_MONITORING_REPORTS;
var INITIAL_PARTICIPANT_DATABASE = SEED_PARTICIPANT_DATABASE;
var INITIAL_PROGRAM_BUDGETS = SEED_PROGRAM_BUDGETS;
function cloneInitialUsers() {
  return INITIAL_USERS.map((u) => ({
    ...u,
    permissions: { ...u.permissions }
  }));
}
function createDefaultSeed() {
  return {
    users: cloneInitialUsers(),
    currentUserId: "user-director",
    programs: [...INITIAL_PROGRAMS],
    outcomes: [...INITIAL_OUTCOMES],
    outputs: [...INITIAL_OUTPUTS],
    activities: [...INITIAL_ACTIVITIES],
    subActivities: [...INITIAL_SUB_ACTIVITIES],
    tors: [...INITIAL_TORS],
    approvalRecords: [...INITIAL_APPROVAL_RECORDS],
    auditLogs: [...INITIAL_AUDIT_LOGS],
    cashAdvances: [...INITIAL_CASH_ADVANCES],
    cashAdvanceSummaries: {},
    cashAdvanceAuditLogs: {},
    meetingMinutes: [...INITIAL_MEETING_MINUTES],
    activityDocumentations: { ...INITIAL_ACTIVITY_DOCUMENTATIONS },
    activityDocumentationList: [...INITIAL_ACTIVITY_DOCUMENTATION_LIST],
    outputRaciRecords: { ...INITIAL_OUTPUT_RACI_RECORDS },
    activityMonitoringRecords: { ...INITIAL_ACTIVITY_MONITORING_RECORDS },
    monitoringReports: { ...INITIAL_MONITORING_REPORTS },
    approvalHubItems: {},
    approvalNotifications: [],
    programBudgets: { ...INITIAL_PROGRAM_BUDGETS },
    participantDatabase: [...INITIAL_PARTICIPANT_DATABASE],
    cleanResetPrj3581V1: true,
    cleanResetPrj3581V2: true
  };
}
function createEmptyDatabaseState() {
  return {
    users: [],
    currentUserId: "",
    programs: [],
    outcomes: [],
    outputs: [],
    activities: [],
    subActivities: [],
    tors: [],
    approvalRecords: [],
    auditLogs: [],
    cashAdvances: [],
    cashAdvanceSummaries: {},
    cashAdvanceAuditLogs: {},
    meetingMinutes: [],
    activityDocumentations: {},
    activityDocumentationList: [],
    outputRaciRecords: {},
    activityMonitoringRecords: {},
    monitoringReports: {},
    approvalHubItems: {},
    approvalWorkflowConfigs: {},
    approvalNotifications: [],
    programBudgets: {},
    participantDatabase: [],
    cleanResetPrj3581V1: true,
    cleanResetPrj3581V2: true
  };
}
function normalizeSchema(parsed, options) {
  const isFromMysql = Boolean(options?.isFromMysql);
  if (parsed.cleanResetPrj3581V1 === void 0) {
    parsed.cleanResetPrj3581V1 = true;
  }
  if (parsed.cleanResetPrj3581V2 === void 0) {
    parsed.cleanResetPrj3581V2 = true;
  }
  if (!Array.isArray(parsed.programs)) {
    parsed.programs = [];
  }
  const defaultPermsByRole = {
    admin: { canManagePrograms: false, canCreateTor: false, canApproveTor: false, canManageUsers: true, canViewAllTors: true },
    director: { canManagePrograms: true, canCreateTor: true, canApproveTor: true, canManageUsers: false, canViewAllTors: true },
    hr: { canManagePrograms: false, canCreateTor: true, canApproveTor: false, canManageUsers: false, canViewAllTors: true },
    finance: { canManagePrograms: false, canCreateTor: true, canApproveTor: true, canManageUsers: false, canViewAllTors: true },
    program_manager: { canManagePrograms: true, canCreateTor: true, canApproveTor: true, canManageUsers: false, canViewAllTors: true },
    meal: { canManagePrograms: true, canCreateTor: true, canApproveTor: false, canManageUsers: false, canViewAllTors: true },
    staff: { canManagePrograms: false, canCreateTor: true, canApproveTor: false, canManageUsers: false, canViewAllTors: false }
  };
  if (!Array.isArray(parsed.users) || parsed.users.length === 0) {
    parsed.users = isFromMysql ? [] : cloneInitialUsers();
  } else {
    parsed.users = parsed.users.map((u) => {
      const basePerms = defaultPermsByRole[u.role] || defaultPermsByRole.staff;
      const rawPerms = u.permissions && typeof u.permissions === "object" ? u.permissions : {};
      return {
        ...u,
        permissions: {
          canManagePrograms: rawPerms.canManagePrograms ?? basePerms.canManagePrograms,
          canCreateTor: rawPerms.canCreateTor ?? basePerms.canCreateTor,
          canApproveTor: u.role === "admin" ? false : rawPerms.canApproveTor ?? basePerms.canApproveTor,
          canManageUsers: u.role === "admin" ? true : rawPerms.canManageUsers ?? basePerms.canManageUsers,
          canViewAllTors: rawPerms.canViewAllTors ?? basePerms.canViewAllTors
        }
      };
    });
    if (!isFromMysql) {
      const hasAdmin = parsed.users.some(
        (u) => u.role === "admin" || u.permissions?.canManageUsers
      );
      if (!hasAdmin) {
        const defaultAdmin = INITIAL_USERS.find((u) => u.role === "admin");
        if (defaultAdmin) {
          parsed.users.push({
            ...defaultAdmin,
            permissions: { ...defaultAdmin.permissions },
            isActive: true,
            accountStatus: "Aktif"
          });
        }
      }
    }
  }
  if (!parsed.currentUserId) {
    parsed.currentUserId = parsed.users[0]?.id || "user-director";
  }
  if (!Array.isArray(parsed.outcomes)) {
    parsed.outcomes = [];
  }
  if (!Array.isArray(parsed.outputs)) {
    parsed.outputs = [];
  }
  if (!Array.isArray(parsed.activities)) {
    parsed.activities = [];
  }
  if (!Array.isArray(parsed.subActivities)) {
    parsed.subActivities = [];
  }
  const outcomeByIdMap = /* @__PURE__ */ new Map();
  for (const oc of parsed.outcomes) {
    if (oc && oc.id) {
      outcomeByIdMap.set(oc.id, oc);
    }
  }
  const outputByIdMap = /* @__PURE__ */ new Map();
  parsed.outputs = parsed.outputs.map((op) => {
    const parentOc = op?.outcomeId ? outcomeByIdMap.get(op.outcomeId) : void 0;
    const enriched = !op?.programId && parentOc?.programId ? { ...op, programId: parentOc.programId } : op;
    if (enriched && enriched.id) {
      outputByIdMap.set(enriched.id, enriched);
    }
    return enriched;
  });
  const activityByIdMap = /* @__PURE__ */ new Map();
  parsed.activities = parsed.activities.map((ac) => {
    const parentOp = ac?.outputId ? outputByIdMap.get(ac.outputId) : void 0;
    const resolvedOutcomeId = ac?.outcomeId || parentOp?.outcomeId || "";
    const parentOc = resolvedOutcomeId ? outcomeByIdMap.get(resolvedOutcomeId) : void 0;
    const resolvedProgramId = ac?.programId || parentOp?.programId || parentOc?.programId || "";
    const enriched = !ac?.outcomeId && resolvedOutcomeId || !ac?.programId && resolvedProgramId ? {
      ...ac,
      ...resolvedOutcomeId ? { outcomeId: resolvedOutcomeId } : {},
      ...resolvedProgramId ? { programId: resolvedProgramId } : {}
    } : ac;
    if (enriched && enriched.id) {
      activityByIdMap.set(enriched.id, enriched);
    }
    return enriched;
  });
  parsed.subActivities = parsed.subActivities.map((sa) => {
    const parentAct = sa?.activityId ? activityByIdMap.get(sa.activityId) : void 0;
    if (!parentAct) return sa;
    const needsBackfill = !sa?.outputId && parentAct.outputId || !sa?.outcomeId && parentAct.outcomeId || !sa?.programId && parentAct.programId;
    if (!needsBackfill) return sa;
    return {
      ...sa,
      ...parentAct.outputId && !sa.outputId ? { outputId: parentAct.outputId } : {},
      ...parentAct.outcomeId && !sa.outcomeId ? { outcomeId: parentAct.outcomeId } : {},
      ...parentAct.programId && !sa.programId ? { programId: parentAct.programId } : {}
    };
  });
  if (!Array.isArray(parsed.tors)) {
    parsed.tors = [];
  }
  if (!Array.isArray(parsed.approvalRecords)) {
    parsed.approvalRecords = [];
  }
  if (!Array.isArray(parsed.auditLogs)) {
    parsed.auditLogs = [];
  }
  if (!Array.isArray(parsed.cashAdvances)) {
    parsed.cashAdvances = [];
  }
  if (!parsed.cashAdvanceSummaries || typeof parsed.cashAdvanceSummaries !== "object") {
    parsed.cashAdvanceSummaries = {};
  }
  if (!parsed.cashAdvanceAuditLogs || typeof parsed.cashAdvanceAuditLogs !== "object") {
    parsed.cashAdvanceAuditLogs = {};
  }
  if (Array.isArray(parsed.tors) && Array.isArray(parsed.cashAdvances)) {
    parsed.tors = parsed.tors.map((t) => {
      const approvedCas = parsed.cashAdvances.filter(
        (ca) => ca.torId === t.id && (ca.status === "Disetujui" || ca.status === "Dicairkan")
      );
      const verifiedCas = approvedCas.filter(
        (ca) => ca.isReported && ca.reportApprovalStatus === "Telah Disetujui"
      );
      const computedRequested = approvedCas.reduce(
        (sum, ca) => sum + (Number(ca.totalAmount) || 0),
        0
      );
      const computedActualSpent = verifiedCas.reduce(
        (sum, ca) => sum + (Number(ca.realizedAmount ?? ca.totalAmount) || 0),
        0
      );
      return {
        ...t,
        budgetRequested: approvedCas.length > 0 ? computedRequested : t.budgetRequested ?? 0,
        budgetApproved: t.budgetApproved ?? t.budgetRequested ?? 0,
        budgetActualSpent: verifiedCas.length > 0 ? computedActualSpent : t.budgetActualSpent ?? 0
      };
    });
  }
  if (!Array.isArray(parsed.meetingMinutes)) {
    parsed.meetingMinutes = [];
  }
  if (!parsed.activityDocumentations || typeof parsed.activityDocumentations !== "object") {
    parsed.activityDocumentations = {};
  }
  if (!Array.isArray(parsed.activityDocumentationList)) {
    parsed.activityDocumentationList = [];
  }
  if (Array.isArray(parsed.tors)) {
    parsed.tors = parsed.tors.map((t) => ({
      ...t,
      documentation: parsed.activityDocumentationList?.find((d) => d.torId === t.id) || parsed.activityDocumentations?.[t.id] || t.documentation
    }));
  }
  if (!parsed.outputRaciRecords || typeof parsed.outputRaciRecords !== "object") {
    parsed.outputRaciRecords = {};
  }
  if (!parsed.activityMonitoringRecords || typeof parsed.activityMonitoringRecords !== "object") {
    parsed.activityMonitoringRecords = {};
  }
  if (!parsed.monitoringReports || typeof parsed.monitoringReports !== "object") {
    parsed.monitoringReports = {};
  }
  if (!parsed.approvalHubItems || typeof parsed.approvalHubItems !== "object") {
    parsed.approvalHubItems = {};
  }
  if (!Array.isArray(parsed.approvalNotifications)) {
    parsed.approvalNotifications = [];
  }
  if (!Array.isArray(parsed.participantDatabase)) {
    parsed.participantDatabase = [];
  }
  if (!parsed.programBudgets || typeof parsed.programBudgets !== "object") {
    parsed.programBudgets = {};
  }
  return parsed;
}
function sanitizeDbError(err) {
  const raw = err instanceof Error ? `${err.name}${"code" in err && err.code ? ` [${err.code}]` : ""}: ${err.message}` : String(err || "Unknown error");
  return raw.replace(/mysql2?:\/\/[^\s@]+@/gi, "mysql://***@").replace(/(password\s*[=:]\s*)([^\s,;]+)/gi, "$1***");
}
function buildMysqlWriteFailureError(err, contextLabel) {
  const sqlCode = String(err?.code || "");
  const failedTable = err?.failedTable ? String(err.failedTable) : void 0;
  const failedStage = err?.failedStage ? String(err.failedStage) : void 0;
  const safeDetail = sanitizeDbError(err);
  const tableInfo = failedTable ? ` pada tabel '${failedTable}'` : "";
  const codeInfo = sqlCode ? ` (${sqlCode})` : "";
  let httpStatus = 500;
  let userMessage = `[DATABASE WRITE ERROR] Gagal menyimpan perubahan${tableInfo} ke database MySQL produksi${codeInfo}. Perubahan dibatalkan agar tampilan tetap akurat.`;
  if (sqlCode === "ER_TABLEACCESS_DENIED_ERROR" || sqlCode === "ER_DBACCESS_DENIED_ERROR" || sqlCode === "ER_SPECIFIC_ACCESS_DENIED_ERROR" || /command denied to user/i.test(safeDetail)) {
    httpStatus = 500;
    userMessage = `[DATABASE WRITE ERROR] Database MySQL menolak penyimpanan${tableInfo} karena user database belum memiliki hak akses tulis (INSERT / UPDATE / DELETE). Periksa hak akses user MySQL di panel Hostinger.`;
  } else if (sqlCode === "ECONNREFUSED" || sqlCode === "PROTOCOL_CONNECTION_LOST" || sqlCode === "ETIMEDOUT" || sqlCode === "EHOSTUNREACH") {
    httpStatus = 503;
    userMessage = "[DATABASE WRITE ERROR] Koneksi ke server MySQL terputus saat menyimpan data. Silakan coba kembali beberapa saat lagi.";
  } else if (sqlCode === "ER_NO_REFERENCED_ROW_2" || sqlCode === "ER_NO_REFERENCED_ROW" || sqlCode === "PROGRAM_NOT_FOUND_IN_MYSQL") {
    httpStatus = 400;
    userMessage = `[DATABASE WRITE ERROR] Relasi data induk tidak ditemukan${tableInfo}${codeInfo}. Pastikan Program, Outcome, atau Output induk sudah tersimpan di database MySQL.`;
  } else if (sqlCode === "ER_ROW_IS_REFERENCED_2" || sqlCode === "ER_ROW_IS_REFERENCED") {
    httpStatus = 409;
    userMessage = `[DATABASE WRITE ERROR] Data${tableInfo} tidak dapat dihapus atau diubah karena masih direferensikan oleh data turunan di database MySQL${codeInfo}.`;
  } else if (sqlCode === "ER_BAD_NULL_ERROR" || sqlCode === "ER_NO_DEFAULT_FOR_FIELD") {
    httpStatus = 400;
    userMessage = `[DATABASE WRITE ERROR] Kolom wajib${tableInfo} belum lengkap untuk struktur tabel MySQL${codeInfo}. Perubahan dibatalkan agar data tetap konsisten.`;
  } else if (sqlCode === "ER_NO_SUCH_TABLE" || sqlCode === "ER_BAD_FIELD_ERROR") {
    httpStatus = 500;
    userMessage = `[DATABASE WRITE ERROR] Struktur tabel atau kolom${tableInfo} di database MySQL belum sesuai${codeInfo}.`;
  } else if (sqlCode === "ER_DUP_ENTRY") {
    httpStatus = 409;
    userMessage = `[DATABASE WRITE ERROR] Data dengan kode atau identitas tersebut sudah terdaftar${tableInfo} di database MySQL.`;
  } else if (sqlCode === "ER_DATA_TOO_LONG" || sqlCode === "ER_TRUNCATED_WRONG_VALUE") {
    httpStatus = 400;
    userMessage = `[DATABASE WRITE ERROR] Format atau panjang data tidak sesuai dengan kolom${tableInfo} di MySQL${codeInfo}. Periksa kembali isian Anda.`;
  }
  return Object.assign(new Error(`[MySQL Write Failed: ${contextLabel}] ${safeDetail}`), {
    httpStatus,
    userMessage,
    code: sqlCode || void 0,
    errorCategory: "DATABASE_WRITE_ERROR",
    failedTable,
    failedStage
  });
}
var Database = class {
  constructor() {
    this.lastCommittedJson = "";
    this.dirtySinceCommit = false;
    this.isCommittingWrite = false;
    this.mysqlWriteChain = Promise.resolve();
    this.initPromise = null;
    this.mysqlStatus = "unconfigured";
    this.lastMysqlErrorSummary = "";
    this.lastUsersRefreshAt = 0;
    this.lastFullMysqlSyncAt = 0;
    this.privilegeSummary = null;
    this.isInitializing = false;
    this.lastFailedMysqlAttemptAt = 0;
    this.failedMysqlCycles = 0;
    this.ensureDirectory();
    if (this.isStrictMysqlRequired()) {
      this.data = createEmptyDatabaseState();
    } else {
      this.data = this.loadInitialLocalDevData();
    }
    this.lastCommittedJson = JSON.stringify(this.data);
    this.initPromise = this.initializeMysqlStorage();
  }
  /**
   * Bernilai true apabila aplikasi wajib menggunakan MySQL tanpa fallback ke JSON/mock data:
   * - Kredensial MySQL (MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE) dikonfigurasi, ATAU
   * - Berjalan di environment produksi Hostinger (bukan container preview Cloud Run), ATAU
   * - MYSQL_STRICT_REQUIRED='true'.
   */
  isStrictMysqlRequired() {
    return isMysqlConfigured() || isProductionHostingerEnvironment() || process.env.MYSQL_STRICT_REQUIRED === "true";
  }
  /**
   * Menunggu hingga proses inisialisasi database selesai sepenuhnya.
   * Jika percobaan sebelumnya gagal (status 'failed'), memanggil ready() akan mencoba menginisialisasi ulang secara aman.
   */
  async ready() {
    if (!this.initPromise || this.isStrictMysqlRequired() && this.mysqlStatus === "failed" && !this.isInitializing) {
      this.initPromise = this.initializeMysqlStorage();
    }
    await this.initPromise;
  }
  isMysqlReady() {
    return this.mysqlStatus === "ready";
  }
  getLastErrorSummary() {
    return this.lastMysqlErrorSummary;
  }
  getDiagnostics() {
    const envCheck = validateMysqlEnvConfiguration();
    return {
      provider: this.isStrictMysqlRequired() ? "mysql" : "preview-local",
      status: this.mysqlStatus,
      operational: this.isOperational(),
      mysqlConfigured: envCheck.configured,
      missingEnvVars: envCheck.missingVars,
      privileges: this.privilegeSummary ? {
        checked: this.privilegeSummary.checked,
        canSelect: this.privilegeSummary.canSelect,
        canInsert: this.privilegeSummary.canInsert,
        canUpdate: this.privilegeSummary.canUpdate,
        canDelete: this.privilegeSummary.canDelete
      } : void 0,
      lastError: this.lastMysqlErrorSummary || void 0,
      counts: {
        users: (this.data.users || []).length,
        programs: (this.data.programs || []).length,
        tors: (this.data.tors || []).length
      }
    };
  }
  /**
   * Jika MySQL dikonfigurasi namun sempat gagal saat startup (misal MySQL server baru aktif),
   * coba hubungkan ulang secara berkala dengan exponential backoff.
   */
  async retryMysqlIfNeeded() {
    if (!this.isStrictMysqlRequired() || this.isMysqlReady() || this.isInitializing) {
      return false;
    }
    const now = Date.now();
    const backoffMs = Math.min(6e4, 5e3 * Math.pow(2, Math.max(0, this.failedMysqlCycles - 1)));
    if (now - this.lastFailedMysqlAttemptAt < backoffMs) {
      return false;
    }
    this.initPromise = this.initializeMysqlStorage(1);
    await this.initPromise;
    return this.isMysqlReady();
  }
  /**
   * Bernilai true apabila database siap melayani aplikasi:
   * - Pada mode produksi / MySQL: HANYA bernilai true jika koneksi & pembacaan MySQL berhasil ('ready').
   *   Tidak ada fallback otomatis ke JSON atau in-memory seed apabila MySQL gagal terhubung.
   * - Pada mode preview Cloud Run (tanpa MySQL): bernilai true menggunakan penyimpanan preview.
   */
  isOperational() {
    if (this.isStrictMysqlRequired()) {
      return this.mysqlStatus === "ready";
    }
    return true;
  }
  enqueueWriteTask(task) {
    const run = this.mysqlWriteChain.then(task, task);
    this.mysqlWriteChain = run.then(
      () => void 0,
      () => void 0
    );
    return run;
  }
  /**
   * Menunggu seluruh antrean penulisan asynchronous ke MySQL selesai.
   */
  async flushWrites() {
    await this.mysqlWriteChain;
  }
  /**
   * Menyelaraskan baseline snapshot bersih setelah normalisasi memori non-mutasi (seperti saat startup / reload).
   */
  syncCleanBaseline() {
    if (!this.dirtySinceCommit && !this.isCommittingWrite) {
      this.lastCommittedJson = JSON.stringify(this.data);
    }
  }
  hasUncommittedChanges() {
    return this.dirtySinceCommit;
  }
  rollbackUncommittedChanges() {
    if (this.dirtySinceCommit && this.lastCommittedJson) {
      try {
        this.data = JSON.parse(this.lastCommittedJson);
      } catch {
      }
      this.dirtySinceCommit = false;
    }
  }
  /**
   * Menyimpan seluruh perubahan yang dilakukan melalui `db.update()` ke MySQL secara sinkron & atomik.
   * Jika query INSERT/UPDATE/DELETE ke MySQL gagal, state memori (`this.data`) dikembalikan ke state terakhir
   * yang sudah ter-commit di MySQL, dan error dilempar agar API TIDAK PERNAH mengembalikan sukses palsu (fake 200 OK).
   */
  async commitPendingWrites(contextLabel = "write") {
    if (!this.isStrictMysqlRequired()) {
      if (this.dirtySinceCommit) {
        this.persistLocalJsonOnly(this.data);
        this.lastCommittedJson = JSON.stringify(this.data);
        this.dirtySinceCommit = false;
      }
      return;
    }
    if (this.mysqlStatus !== "ready") {
      this.rollbackUncommittedChanges();
      throw Object.assign(new Error("MySQL database is not ready for write operations."), {
        httpStatus: 503,
        userMessage: "Database MySQL sedang tidak siap menerima penyimpanan data. Silakan muat ulang halaman dan coba kembali."
      });
    }
    if (!this.dirtySinceCommit) {
      return;
    }
    await this.enqueueWriteTask(async () => {
      if (!this.dirtySinceCommit) {
        return;
      }
      this.isCommittingWrite = true;
      try {
        const pool = await getMysqlPool();
        if (!pool) {
          throw new Error("MySQL connection pool is unavailable during commit.");
        }
        const prevData = this.lastCommittedJson ? JSON.parse(this.lastCommittedJson) : createEmptyDatabaseState();
        const nextSnapshotJson = JSON.stringify(this.data);
        const nextData = JSON.parse(nextSnapshotJson);
        await saveDiffToMysql(pool, prevData, nextData, contextLabel);
        this.lastCommittedJson = nextSnapshotJson;
        this.dirtySinceCommit = false;
        this.lastFullMysqlSyncAt = Date.now();
        this.lastUsersRefreshAt = Date.now();
      } catch (err) {
        this.lastMysqlErrorSummary = sanitizeDbError(err);
        if (this.lastCommittedJson) {
          try {
            this.data = JSON.parse(this.lastCommittedJson);
          } catch {
          }
        }
        this.dirtySinceCommit = false;
        throw buildMysqlWriteFailureError(err, contextLabel);
      } finally {
        this.isCommittingWrite = false;
      }
    });
  }
  /**
   * Mengeksekusi seluruh batch Import Excel Hirarki Program dalam satu transaksi atomik:
   * - Pada mode MySQL produksi: memverifikasi Program induk di MySQL, menjalankan START TRANSACTION -> outcomes -> outputs -> activities -> sub_activities -> COMMIT,
   *   lalu membaca ulang (SELECT) state terbaru dari MySQL agar data di memori & respons API 100% akurat sesuai isi tabel MySQL.
   * - Jika gagal di tahap mana pun: ROLLBACK penuh tanpa meninggalkan data parsial.
   */
  async executeHierarchyImportTransaction(batchParams) {
    const contextLabel = `POST /api/programs/${batchParams.programId}/import-hierarchy`;
    if (!this.isStrictMysqlRequired()) {
      const backupJson = JSON.stringify(this.data);
      try {
        console.log(`[IMPORT] DATABASE TRANSACTION STARTED (programId=${batchParams.programId}, mode=preview-local)`);
        const progExists = (this.data.programs || []).some((p) => p.id === batchParams.programId);
        if (!progExists) {
          throw Object.assign(
            new Error(`Parent program '${batchParams.programId}' not found.`),
            {
              code: "PROGRAM_NOT_FOUND_IN_MYSQL",
              failedTable: "programs",
              failedStage: "PROGRAM VERIFICATION"
            }
          );
        }
        console.log(`[IMPORT] PROGRAM VERIFIED (programId=${batchParams.programId})`);
        const upsertById = (list, incoming) => {
          const map = /* @__PURE__ */ new Map();
          for (const item of list) map.set(item.id, item);
          for (const item of incoming) map.set(item.id, item);
          return Array.from(map.values());
        };
        console.log(`[IMPORT] OUTCOME INSERT STARTED (count=${batchParams.outcomesToUpsert.length})`);
        this.data.outcomes = upsertById(this.data.outcomes || [], batchParams.outcomesToUpsert);
        console.log(`[IMPORT] OUTPUT INSERT STARTED (count=${batchParams.outputsToUpsert.length})`);
        this.data.outputs = upsertById(this.data.outputs || [], batchParams.outputsToUpsert);
        console.log(`[IMPORT] ACTIVITY INSERT STARTED (count=${batchParams.activitiesToUpsert.length})`);
        this.data.activities = upsertById(this.data.activities || [], batchParams.activitiesToUpsert);
        if (batchParams.subActivitiesToUpsert.length > 0) {
          this.data.subActivities = upsertById(
            this.data.subActivities || [],
            batchParams.subActivitiesToUpsert
          );
        }
        if (batchParams.auditLog) {
          this.data.auditLogs = [...this.data.auditLogs || [], batchParams.auditLog];
        }
        this.persistLocalJsonOnly(this.data);
        this.lastCommittedJson = JSON.stringify(this.data);
        this.dirtySinceCommit = false;
        console.log(`[IMPORT] COMMIT SUCCESS (programId=${batchParams.programId}, mode=preview-local)`);
        return this.data;
      } catch (err) {
        this.data = JSON.parse(backupJson);
        this.dirtySinceCommit = false;
        throw buildMysqlWriteFailureError(err, contextLabel);
      }
    }
    if (this.mysqlStatus !== "ready") {
      throw Object.assign(new Error("MySQL database is not ready for hierarchy import."), {
        httpStatus: 503,
        errorCategory: "DATABASE_WRITE_ERROR",
        userMessage: "[DATABASE WRITE ERROR] Database MySQL sedang tidak siap menerima import hirarki. Silakan muat ulang halaman dan coba kembali."
      });
    }
    return this.enqueueWriteTask(async () => {
      this.isCommittingWrite = true;
      try {
        const pool = await getMysqlPool();
        if (!pool) {
          throw new Error("MySQL connection pool is unavailable during hierarchy import.");
        }
        await importProgramHierarchyToMysql(pool, batchParams);
        const freshFromMysql = await loadDatabaseFromMysql(pool);
        if (freshFromMysql) {
          this.data = normalizeSchema(freshFromMysql, { isFromMysql: true });
          this.lastCommittedJson = JSON.stringify(this.data);
          this.dirtySinceCommit = false;
          this.lastFullMysqlSyncAt = Date.now();
          this.lastUsersRefreshAt = Date.now();
        }
        return this.data;
      } catch (err) {
        this.lastMysqlErrorSummary = sanitizeDbError(err);
        if (this.lastCommittedJson) {
          try {
            this.data = JSON.parse(this.lastCommittedJson);
          } catch {
          }
        }
        this.dirtySinceCommit = false;
        throw buildMysqlWriteFailureError(err, contextLabel);
      } finally {
        this.isCommittingWrite = false;
      }
    });
  }
  /**
   * Menyegarkan data aplikasi dari MySQL apabila cache memori lebih lama dari `maxAgeMs`
   * dan tidak ada transaksi tulis yang sedang berlangsung, sehingga refresh halaman selalu
   * menampilkan data aktual yang benar-benar tersimpan di MySQL.
   */
  async refreshFromMysqlIfStale(maxAgeMs = 1500) {
    if (!isMysqlConfigured() || this.mysqlStatus !== "ready" || this.dirtySinceCommit || this.isCommittingWrite) {
      return false;
    }
    const now = Date.now();
    if (now - this.lastFullMysqlSyncAt < maxAgeMs) {
      return false;
    }
    try {
      const pool = await getMysqlPool();
      if (!pool) return false;
      const fresh = await loadDatabaseFromMysql(pool);
      if (fresh && !this.dirtySinceCommit && !this.isCommittingWrite) {
        this.data = normalizeSchema(fresh, { isFromMysql: true });
        this.lastCommittedJson = JSON.stringify(this.data);
        this.lastFullMysqlSyncAt = Date.now();
        this.lastUsersRefreshAt = Date.now();
        return true;
      }
    } catch (err) {
      console.warn(`[DB] Warning refreshing state from MySQL: ${sanitizeDbError(err)}`);
    }
    return false;
  }
  /**
   * Membaca ulang daftar pengguna & password_hash terbaru langsung dari tabel `users` MySQL
   * agar login dan pengelolaan akun selalu menggunakan Single Source of Truth di MySQL.
   */
  async refreshUsersFromMysql(force = false) {
    if (!isMysqlConfigured() || this.mysqlStatus !== "ready" || this.dirtySinceCommit || this.isCommittingWrite) {
      return this.data.users || [];
    }
    const now = Date.now();
    if (!force && now - this.lastUsersRefreshAt < 2e3 && this.data.users.length > 0) {
      return this.data.users;
    }
    try {
      const pool = await getMysqlPool();
      if (!pool) return this.data.users || [];
      const freshUsers = await fetchUsersFromMysql(pool);
      if (Array.isArray(freshUsers) && freshUsers.length > 0 && !this.dirtySinceCommit && !this.isCommittingWrite) {
        this.data.users = freshUsers;
        this.lastUsersRefreshAt = now;
        this.lastCommittedJson = JSON.stringify(this.data);
      }
    } catch (err) {
      console.warn(`[DB] Warning refreshing users from MySQL: ${sanitizeDbError(err)}`);
    }
    return this.data.users || [];
  }
  /**
   * Menjamin perubahan akun / password pengguna langsung tersimpan atomik ke tabel users MySQL
   * sebelum server mengembalikan respons sukses ke klien. Jika gagal, melempar error & rollback memori.
   */
  async syncUserImmediately(user, options) {
    const label = options?.contextLabel || `user-sync:${user?.id || "unknown"}`;
    if (!this.isStrictMysqlRequired()) {
      await this.commitPendingWrites(label);
      return;
    }
    try {
      if (this.dirtySinceCommit) {
        await this.commitPendingWrites(label);
      } else if (isMysqlConfigured() && this.mysqlStatus === "ready" && user?.id) {
        await this.enqueueWriteTask(async () => {
          const pool = await getMysqlPool();
          if (!pool) throw new Error("MySQL connection pool is unavailable.");
          await upsertMysqlUserRow(pool, user);
          this.lastUsersRefreshAt = Date.now();
          this.lastCommittedJson = JSON.stringify(this.data);
        });
      }
    } catch (err) {
      if (options?.bestEffortMetadataOnly) {
        console.warn(
          `[DB] Non-critical login/session metadata update skipped (${label}): ${sanitizeDbError(err)}`
        );
        return;
      }
      throw err;
    }
  }
  async removeUserImmediately(userId) {
    const label = `user-delete:${userId}`;
    if (!this.isStrictMysqlRequired()) {
      await this.commitPendingWrites(label);
      return;
    }
    if (this.mysqlStatus !== "ready") {
      this.rollbackUncommittedChanges();
      throw Object.assign(new Error("MySQL database is not ready for user deletion."), {
        httpStatus: 503,
        userMessage: "Database MySQL sedang tidak tersedia untuk menghapus akun pengguna."
      });
    }
    await this.enqueueWriteTask(async () => {
      this.isCommittingWrite = true;
      try {
        const pool = await getMysqlPool();
        if (!pool) {
          throw new Error("MySQL connection pool is unavailable.");
        }
        await deleteMysqlUserRow(pool, userId);
        if (this.dirtySinceCommit) {
          const prevData = this.lastCommittedJson ? JSON.parse(this.lastCommittedJson) : createEmptyDatabaseState();
          const nextSnapshotJson = JSON.stringify(this.data);
          const nextData = JSON.parse(nextSnapshotJson);
          await saveDiffToMysql(pool, prevData, nextData, label);
          this.lastCommittedJson = nextSnapshotJson;
          this.dirtySinceCommit = false;
        } else {
          this.lastCommittedJson = JSON.stringify(this.data);
        }
        this.lastUsersRefreshAt = Date.now();
        this.lastFullMysqlSyncAt = Date.now();
      } catch (err) {
        this.lastMysqlErrorSummary = sanitizeDbError(err);
        if (this.lastCommittedJson) {
          try {
            this.data = JSON.parse(this.lastCommittedJson);
          } catch {
          }
        }
        this.dirtySinceCommit = false;
        throw buildMysqlWriteFailureError(err, label);
      } finally {
        this.isCommittingWrite = false;
      }
    });
  }
  ensureDirectory() {
    if (!fs2.existsSync(DATA_DIR)) {
      fs2.mkdirSync(DATA_DIR, { recursive: true });
    }
  }
  persistLocalJsonOnly(snapshot) {
    if (this.isStrictMysqlRequired()) {
      return;
    }
    try {
      const jsonText = JSON.stringify(snapshot, null, 2);
      fs2.writeFileSync(DB_FILE, jsonText, "utf-8");
    } catch {
    }
  }
  persistExplicitBackup(snapshot) {
    try {
      const jsonText = JSON.stringify(snapshot, null, 2);
      fs2.writeFileSync(DB_BACKUP_FILE, jsonText, "utf-8");
    } catch {
    }
  }
  /**
   * Hanya digunakan untuk mode preview Cloud Run ketika tidak ada MySQL eksternal yang dikonfigurasi.
   * Tidak pernah dipanggil di lingkungan produksi Hostinger atau ketika MySQL dikonfigurasi.
   */
  loadInitialLocalDevData() {
    try {
      if (fs2.existsSync(DB_FILE)) {
        const fileContent = fs2.readFileSync(DB_FILE, "utf-8");
        const rawParsed = JSON.parse(fileContent);
        const normalized = normalizeSchema(rawParsed, { isFromMysql: false });
        this.persistLocalJsonOnly(normalized);
        return normalized;
      }
    } catch (err) {
      console.warn("[DB] Failed to read preview data/db.json, using default seed:", sanitizeDbError(err));
    }
    const fresh = normalizeSchema(createDefaultSeed(), { isFromMysql: false });
    this.persistLocalJsonOnly(fresh);
    return fresh;
  }
  async initializeMysqlStorage(maxAttempts = 3) {
    const envCheck = validateMysqlEnvConfiguration();
    if (!isMysqlConfigured()) {
      if (this.isStrictMysqlRequired()) {
        this.mysqlStatus = "failed";
        this.data = createEmptyDatabaseState();
        this.lastCommittedJson = JSON.stringify(this.data);
        this.lastMysqlErrorSummary = `Missing required MySQL environment variables (${envCheck.missingVars.join(", ")})`;
        console.error(
          `[DB] MySQL connection or initialization failed: ${this.lastMysqlErrorSummary}. Set MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE.`
        );
      } else {
        this.mysqlStatus = "unconfigured";
      }
      return;
    }
    this.isInitializing = true;
    let lastError = null;
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const pool = await verifyAndGetMysqlPool();
          console.log(`[DB] MySQL connected successfully (${envCheck.safeSummary}).`);
          this.privilegeSummary = await checkMysqlWritePrivileges(pool);
          try {
            await ensureMysqlSchema(pool);
          } catch (schemaErr) {
            console.warn(
              `[DB] Non-destructive schema verification notice: ${sanitizeDbError(schemaErr)}`
            );
          }
          const existingFromMysql = await loadDatabaseFromMysql(pool);
          if (existingFromMysql) {
            const missingFlags = {};
            if (existingFromMysql.cleanResetPrj3581V1 === void 0) {
              missingFlags.cleanResetPrj3581V1 = true;
            }
            if (existingFromMysql.cleanResetPrj3581V2 === void 0) {
              missingFlags.cleanResetPrj3581V2 = true;
            }
            this.data = normalizeSchema(existingFromMysql, { isFromMysql: true });
            this.lastCommittedJson = JSON.stringify(this.data);
            this.dirtySinceCommit = false;
            this.mysqlStatus = "ready";
            this.lastMysqlErrorSummary = "";
            this.failedMysqlCycles = 0;
            this.lastUsersRefreshAt = Date.now();
            this.lastFullMysqlSyncAt = Date.now();
            if (Object.keys(missingFlags).length > 0) {
              try {
                await upsertMysqlKvEntries(pool, missingFlags);
              } catch (kvErr) {
                console.warn(
                  `[DB] Metadata flag initialization skipped: ${sanitizeDbError(kvErr)}`
                );
              }
            }
            console.log(
              `[DB] Existing application data loaded from MySQL (users=${this.data.users.length}, programs=${this.data.programs.length}, tors=${this.data.tors.length}).`
            );
            return;
          }
          console.log("[DB] Database is empty. Initial seed is being created.");
          const initialSeed = normalizeSchema(createDefaultSeed(), { isFromMysql: false });
          await saveDatabaseToMysql(pool, initialSeed);
          this.data = initialSeed;
          this.lastCommittedJson = JSON.stringify(this.data);
          this.dirtySinceCommit = false;
          this.mysqlStatus = "ready";
          this.lastMysqlErrorSummary = "";
          this.failedMysqlCycles = 0;
          this.lastUsersRefreshAt = Date.now();
          this.lastFullMysqlSyncAt = Date.now();
          console.log("[DB] Initial seed saved successfully to MySQL.");
          return;
        } catch (err) {
          lastError = err;
          await resetMysqlPool();
          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 1e3));
          }
        }
      }
      this.lastFailedMysqlAttemptAt = Date.now();
      this.failedMysqlCycles += 1;
      this.mysqlStatus = "failed";
      this.lastMysqlErrorSummary = sanitizeDbError(lastError);
      this.data = createEmptyDatabaseState();
      this.lastCommittedJson = JSON.stringify(this.data);
      this.dirtySinceCommit = false;
      console.error(`[DB] MySQL connection or initialization failed: ${this.lastMysqlErrorSummary}`);
    } finally {
      this.isInitializing = false;
    }
  }
  getData() {
    return this.data;
  }
  update(updater) {
    if (!this.isStrictMysqlRequired()) {
      updater(this.data);
      this.persistLocalJsonOnly(this.data);
      this.lastCommittedJson = JSON.stringify(this.data);
      this.dirtySinceCommit = false;
      return this.data;
    }
    if (this.mysqlStatus !== "ready") {
      throw Object.assign(new Error("MySQL database is not ready to accept updates."), {
        httpStatus: 503,
        userMessage: "Database MySQL sedang tidak tersedia. Perubahan tidak dapat diproses saat ini."
      });
    }
    if (!this.lastCommittedJson) {
      this.lastCommittedJson = JSON.stringify(this.data);
    }
    updater(this.data);
    this.dirtySinceCommit = true;
    return this.data;
  }
  resetToSeed() {
    if (this.isStrictMysqlRequired()) {
      throw new Error("Reset to seed is strictly prohibited when connected to MySQL production database.");
    }
    this.data = normalizeSchema(createDefaultSeed(), { isFromMysql: false });
    this.persistExplicitBackup(this.data);
    this.persistLocalJsonOnly(this.data);
    this.lastCommittedJson = JSON.stringify(this.data);
    this.dirtySinceCommit = false;
    return this.data;
  }
};
var db = new Database();

// src/lib/torNumberGenerator.ts
var ROMAN_MONTHS = {
  1: "I",
  2: "II",
  3: "III",
  4: "IV",
  5: "V",
  6: "VI",
  7: "VII",
  8: "VIII",
  9: "IX",
  10: "X",
  11: "XI",
  12: "XII"
};
function getRomanMonth(dateInput) {
  if (typeof dateInput === "number") {
    return ROMAN_MONTHS[dateInput] || "I";
  }
  const date = dateInput ? new Date(dateInput) : /* @__PURE__ */ new Date();
  const month = isNaN(date.getTime()) ? (/* @__PURE__ */ new Date()).getMonth() + 1 : date.getMonth() + 1;
  return ROMAN_MONTHS[month] || "I";
}
function generateProgramCode(programName, explicitCode) {
  if (explicitCode && explicitCode.trim()) {
    return explicitCode.trim().toUpperCase();
  }
  if (!programName || !programName.trim()) {
    return "";
  }
  const words = programName.trim().split(/[\s\-_/]+/);
  const codeChars = [];
  for (const word of words) {
    const cleanWord = word.replace(/[^a-zA-Z0-9]/g, "");
    if (cleanWord.length > 0) {
      if (/^\d{4}$/.test(cleanWord) && codeChars.length > 0) {
        continue;
      }
      codeChars.push(cleanWord[0].toUpperCase());
    }
  }
  return codeChars.join("");
}
function computeHierarchyCode(params) {
  const {
    programId,
    outcomeId,
    outputId,
    activityId,
    outcomes = [],
    outputs = [],
    activities = []
  } = params;
  let outcomeNum = null;
  let outputNum = null;
  let activityNum = null;
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
  const outcomePart = outcomeNum !== null ? String(outcomeNum) : "[Outcome]";
  const outputPart = outputNum !== null ? String(outputNum) : "[Output]";
  const actPart = activityNum !== null ? String(activityNum) : "[Activity]";
  const hierarchyCode = `${outcomePart}.${outputPart}.${actPart}`;
  return {
    outcomeNum,
    outputNum,
    activityNum,
    hierarchyCode,
    isComplete
  };
}
function formatTorNumber(params) {
  const seqPadded = typeof params.sequence === "number" ? String(params.sequence).padStart(3, "0") : String(params.sequence).padStart(3, "0");
  const prog = params.programCode.trim() || "PROG";
  const hier = params.hierarchyCode.trim() || "1.1.1";
  const month = params.romanMonth.trim() || "I";
  const yr = String(params.year).trim() || (/* @__PURE__ */ new Date()).getFullYear().toString();
  return `TOR/${seqPadded}/WIJNA/${prog}/${hier}/${month}/${yr}`;
}
function getTorDraftPreview(params) {
  const d = params.date ? new Date(params.date) : /* @__PURE__ */ new Date();
  const validDate = isNaN(d.getTime()) ? /* @__PURE__ */ new Date() : d;
  const romanMonth = getRomanMonth(validDate);
  const year = validDate.getFullYear().toString();
  const sequenceStr = params.sequence ? String(params.sequence).padStart(3, "0") : "001";
  const programCode = generateProgramCode(params.programName, params.explicitProgramCode);
  const { hierarchyCode, isComplete: isHierarchyComplete, outcomeNum, outputNum, activityNum } = computeHierarchyCode({
    programId: params.programId,
    outcomeId: params.outcomeId,
    outputId: params.outputId,
    activityId: params.activityId,
    outcomes: params.outcomes,
    outputs: params.outputs,
    activities: params.activities
  });
  const hasProgram = Boolean(programCode && programCode.length > 0);
  if (!hasProgram && !isHierarchyComplete) {
    return {
      previewNumber: `TOR/${sequenceStr}/WIJNA/[Kode Program]/[Outcome].[Output].[Activity]/${romanMonth}/${year}`,
      isComplete: false,
      statusMessage: "Nomor TOR belum lengkap: Pilih Program, Outcome, Output, dan Activity",
      sequenceStr,
      programCode: "",
      hierarchyCode: "[Outcome].[Output].[Activity]",
      romanMonth,
      year
    };
  }
  if (!hasProgram) {
    return {
      previewNumber: `TOR/${sequenceStr}/WIJNA/[Kode Program]/${hierarchyCode}/${romanMonth}/${year}`,
      isComplete: false,
      statusMessage: "Nomor TOR belum lengkap: Silakan pilih Program Induk",
      sequenceStr,
      programCode: "",
      hierarchyCode,
      romanMonth,
      year
    };
  }
  if (!isHierarchyComplete) {
    const missing = [];
    if (!outcomeNum) missing.push("Outcome");
    if (!outputNum) missing.push("Output");
    if (!activityNum) missing.push("Activity");
    return {
      previewNumber: `TOR/${sequenceStr}/WIJNA/${programCode}/${hierarchyCode}/${romanMonth}/${year}`,
      isComplete: false,
      statusMessage: `Nomor TOR belum lengkap: Pilih ${missing.join(", ")}`,
      sequenceStr,
      programCode,
      hierarchyCode,
      romanMonth,
      year
    };
  }
  const preview = formatTorNumber({
    sequence: sequenceStr,
    programCode,
    hierarchyCode,
    romanMonth,
    year
  });
  return {
    previewNumber: preview,
    isComplete: true,
    statusMessage: "Nomor TOR lengkap (Format Otomatis WIJNA)",
    sequenceStr,
    programCode,
    hierarchyCode,
    romanMonth,
    year
  };
}

// src/server/approvalHubService.ts
var ALL_CATEGORIES = [
  "tor",
  "notulen",
  "dokumentasi",
  "executive_summary",
  "cash_advance",
  "laporan_keuangan_akhir"
];
var CATEGORY_META = {
  tor: {
    label: "Terms of Reference (ToR)",
    shortLabel: "ToR",
    groupType: "program_documents",
    verifierRole: "A1",
    finalDirectorMode: "REPORTING",
    flowSummary: "R \u2192 A1 \u2192 Direktur (Pelaporan / Pencatatan)"
  },
  notulen: {
    label: "Notulen Rapat (Meeting Minutes)",
    shortLabel: "Notulen Rapat",
    groupType: "program_documents",
    verifierRole: "A1",
    finalDirectorMode: "REPORTING",
    flowSummary: "R \u2192 A1 \u2192 Direktur (Pelaporan / Pencatatan)"
  },
  dokumentasi: {
    label: "Dokumentasi Kegiatan",
    shortLabel: "Dokumentasi Kegiatan",
    groupType: "program_documents",
    verifierRole: "A1",
    finalDirectorMode: "REPORTING",
    flowSummary: "R \u2192 A1 \u2192 Direktur (Pelaporan / Pencatatan)"
  },
  executive_summary: {
    label: "Executive Summary (Ringkasan Eksekutif)",
    shortLabel: "Executive Summary",
    groupType: "program_documents",
    verifierRole: "A1",
    finalDirectorMode: "REPORTING",
    flowSummary: "R \u2192 A1 \u2192 Direktur (Pelaporan / Pencatatan)"
  },
  cash_advance: {
    label: "Cash Advance Request (Pengajuan Uang Muka)",
    shortLabel: "Cash Advance Request",
    groupType: "financial_documents",
    verifierRole: "A2",
    finalDirectorMode: "FINAL_APPROVAL",
    flowSummary: "R \u2192 A2 \u2192 Direktur (Persetujuan Akhir)"
  },
  laporan_keuangan_akhir: {
    label: "Final Financial Report (Laporan Keuangan Akhir)",
    shortLabel: "Laporan Keuangan Akhir",
    groupType: "financial_documents",
    verifierRole: "A2",
    finalDirectorMode: "FINAL_APPROVAL",
    flowSummary: "R \u2192 A2 \u2192 Direktur (Persetujuan Akhir)"
  }
};
function ensureWorkflowConfigs(draft) {
  if (!draft.approvalWorkflowConfigs) {
    draft.approvalWorkflowConfigs = {};
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  for (const cat of ALL_CATEGORIES) {
    if (!draft.approvalWorkflowConfigs[cat]) {
      draft.approvalWorkflowConfigs[cat] = {
        categoryCode: cat,
        mechanism: "SEQUENTIAL",
        parallelRule: "PRIMARY_WITH_CONSULTATION",
        updatedAt: nowIso,
        updatedByName: "Sistem Default WIJNA"
      };
    }
  }
  return draft.approvalWorkflowConfigs;
}
function resolveDynamicRaciForOutput(draft, outputId, fallbackResponsibleId, fallbackResponsibleName) {
  const raci = draft.outputRaciRecords?.[outputId];
  const output = (draft.outputs || []).find((o) => o.id === outputId);
  const outcome = (draft.outcomes || []).find((oc) => oc.id === output?.outcomeId);
  const activeUsers = (draft.users || []).filter((u) => u.isActive);
  const designatedA2User = raci?.accountableFinanceUserId && activeUsers.find((u) => u.id === raci.accountableFinanceUserId) || activeUsers.find((u) => u.role === "finance" && u.permissions?.canApproveTor !== false) || activeUsers.find((u) => u.role === "finance") || (draft.users || []).find((u) => u.role === "finance");
  const directorUser = activeUsers.find((u) => u.role === "director") || (draft.users || []).find((u) => u.role === "director");
  const pmUser = activeUsers.find((u) => u.role === "program_manager") || (draft.users || []).find((u) => u.role === "program_manager");
  const staffFallback = activeUsers.find((u) => u.role === "staff" || u.role === "meal") || activeUsers[0];
  const responsibleUserId = raci?.responsibleUserId || fallbackResponsibleId || output?.picId || staffFallback?.id || "";
  const responsibleUser = (draft.users || []).find((u) => u.id === responsibleUserId);
  const responsibleUserName = responsibleUser?.name || raci?.responsibleUserName || fallbackResponsibleName || output?.picName || "Responsible (R)";
  const accountableProgramUserId = raci?.accountableUserId || outcome?.picId || pmUser?.id || "";
  const accountableProgramUser = (draft.users || []).find(
    (u) => u.id === accountableProgramUserId
  );
  const accountableProgramUserName = accountableProgramUser?.name || raci?.accountableUserName || outcome?.picName || pmUser?.name || "Accountable Program (A1)";
  const accountableFinanceUserId = raci?.accountableFinanceUserId || designatedA2User?.id || "";
  const accountableFinanceUser = (draft.users || []).find(
    (u) => u.id === accountableFinanceUserId
  );
  const accountableFinanceUserName = accountableFinanceUser?.name || raci?.accountableFinanceUserName || designatedA2User?.name || "Accountable Finance (A2)";
  const directorUserId = directorUser?.id || "";
  const directorUserName = directorUser?.name || "Direktur";
  return {
    responsibleUserId,
    responsibleUserName,
    accountableProgramUserId,
    accountableProgramUserName,
    accountableFinanceUserId,
    accountableFinanceUserName,
    directorUserId,
    directorUserName,
    consultedUsers: raci?.consultedUsers || [],
    informedUsers: raci?.informedUsers || [directorUserName, accountableFinanceUserName].filter(Boolean)
  };
}
function resolveHierarchyAndMonitoring(draft, tor) {
  const activity = (draft.activities || []).find((a) => a.id === tor.activityId);
  const output = (draft.outputs || []).find(
    (o) => o.id === (tor.outputId || activity?.outputId)
  );
  const outcome = (draft.outcomes || []).find(
    (oc) => oc.id === (tor.outcomeId || output?.outcomeId)
  );
  const program = (draft.programs || []).find(
    (p) => p.id === (tor.programId || outcome?.programId)
  );
  const actMon = draft.activityMonitoringRecords?.[tor.activityId];
  const monitoringTools = (actMon?.tools || []).map((t) => ({
    toolId: t.toolId,
    toolName: t.toolName,
    categoryCode: t.categoryCode,
    categoryName: t.categoryName,
    toolUrl: t.toolUrl
  }));
  return {
    programId: program?.id || tor.programId || "",
    programName: program?.name || tor.programName || "",
    outcomeId: outcome?.id || tor.outcomeId || "",
    outcomeName: outcome?.name || tor.outcomeName || "",
    outputId: output?.id || tor.outputId || "",
    outputName: output?.name || tor.outputName || "",
    activityId: activity?.id || tor.activityId || "",
    activityCode: activity?.code || tor.activityCode || "",
    activityName: activity?.name || tor.activityName || tor.title,
    monitoringTools
  };
}
function buildStepsForStatus(params) {
  const meta = CATEGORY_META[params.categoryCode];
  const isProgramDoc = meta.groupType === "program_documents";
  const step2RoleCode = isProgramDoc ? "A1" : "A2";
  const step2UserId = isProgramDoc ? params.accountableProgramUserId : params.accountableFinanceUserId;
  const step2UserName = isProgramDoc ? params.accountableProgramUserName : params.accountableFinanceUserName;
  const step2RoleLabel = isProgramDoc ? "A1 \u2013 Accountable Program" : "A2 \u2013 Accountable Finance";
  const step2ActionLabel = isProgramDoc ? "Pemeriksaan & Persetujuan Program (A1)" : "Verifikasi Dokumen & Kepatuhan Keuangan (A2)";
  const step3ActionLabel = isProgramDoc ? "Pelaporan & Pencatatan Akhir Direktur" : "Persetujuan Akhir Transaksi Keuangan (Direktur)";
  let step1Status = "Selesai";
  let step2Status = "Menunggu Tahap Sebelumnya";
  let step3Status = "Menunggu Tahap Sebelumnya";
  let currentStepNumber = 1;
  let currentActiveRole = "R";
  switch (params.status) {
    case "Draft":
      step1Status = "Sedang Berjalan";
      step2Status = "Menunggu Tahap Sebelumnya";
      step3Status = "Menunggu Tahap Sebelumnya";
      currentStepNumber = 1;
      currentActiveRole = "R";
      break;
    case "Revision Required":
      step1Status = "Perlu Revisi";
      step2Status = "Perlu Revisi";
      step3Status = "Menunggu Tahap Sebelumnya";
      currentStepNumber = 1;
      currentActiveRole = "R";
      break;
    case "Submitted":
    case "Pending Verification":
      step1Status = "Selesai";
      step2Status = "Sedang Berjalan";
      step3Status = "Menunggu Tahap Sebelumnya";
      currentStepNumber = 2;
      currentActiveRole = step2RoleCode;
      break;
    case "Pending Approval":
      step1Status = "Selesai";
      step2Status = "Selesai";
      step3Status = "Sedang Berjalan";
      currentStepNumber = 3;
      currentActiveRole = "Direktur";
      break;
    case "Approved":
      if (isProgramDoc) {
        step1Status = "Selesai";
        step2Status = "Selesai";
        step3Status = "Sedang Berjalan";
        currentStepNumber = 3;
        currentActiveRole = "Direktur";
      } else {
        step1Status = "Selesai";
        step2Status = "Selesai";
        step3Status = "Selesai";
        currentStepNumber = 3;
        currentActiveRole = "Selesai";
      }
      break;
    case "Reported to Director":
    case "Archived":
      step1Status = "Selesai";
      step2Status = "Selesai";
      step3Status = "Selesai";
      currentStepNumber = 3;
      currentActiveRole = "Selesai";
      break;
    case "Rejected":
      step1Status = "Selesai";
      step2Status = "Ditolak";
      step3Status = "Menunggu Tahap Sebelumnya";
      currentStepNumber = 2;
      currentActiveRole = "R";
      break;
  }
  const steps = [
    {
      stepNumber: 1,
      roleCode: "R",
      roleLabel: "R \u2013 Responsible",
      actionTypeLabel: "Penyusunan, Konfirmasi & Pengajuan Dokumen",
      assignedUserId: params.responsibleUserId,
      assignedUserName: params.responsibleUserName,
      status: step1Status,
      actedByUserId: step1Status === "Selesai" ? params.responsibleUserId : void 0,
      actedByUserName: step1Status === "Selesai" ? params.responsibleUserName : void 0,
      receivedAt: params.submittedAt,
      actedAt: step1Status === "Selesai" ? params.submittedAt : void 0,
      notes: step1Status === "Selesai" ? "Dokumen telah disusun dan diajukan melalui Pusat Persetujuan." : void 0,
      signatureCode: step1Status === "Selesai" ? `SIG-${params.refPrefix}-R` : void 0
    },
    {
      stepNumber: 2,
      roleCode: step2RoleCode,
      roleLabel: step2RoleLabel,
      actionTypeLabel: step2ActionLabel,
      assignedUserId: step2UserId,
      assignedUserName: step2UserName,
      status: step2Status,
      actedByUserId: step2Status === "Selesai" || step2Status === "Perlu Revisi" || step2Status === "Ditolak" ? step2UserId : void 0,
      actedByUserName: step2Status === "Selesai" || step2Status === "Perlu Revisi" || step2Status === "Ditolak" ? step2UserName : void 0,
      receivedAt: step1Status === "Selesai" || step2Status === "Perlu Revisi" || step2Status === "Ditolak" ? params.submittedAt : void 0,
      actedAt: step2Status === "Selesai" || step2Status === "Perlu Revisi" || step2Status === "Ditolak" ? params.verifiedAt || params.submittedAt : void 0,
      notes: params.verifiedNotes,
      signatureCode: step2Status === "Selesai" ? `SIG-${params.refPrefix}-${step2RoleCode}` : void 0
    },
    {
      stepNumber: 3,
      roleCode: "Direktur",
      roleLabel: "Direktur Eksekutif",
      actionTypeLabel: step3ActionLabel,
      assignedUserId: params.directorUserId,
      assignedUserName: params.directorUserName,
      status: step3Status,
      actedByUserId: step3Status === "Selesai" ? params.directorUserId : void 0,
      actedByUserName: step3Status === "Selesai" ? params.directorUserName : void 0,
      receivedAt: step2Status === "Selesai" ? params.verifiedAt || params.submittedAt : void 0,
      actedAt: step3Status === "Selesai" ? params.completedAt || params.verifiedAt || params.submittedAt : void 0,
      notes: params.directorNotes,
      signatureCode: step3Status === "Selesai" ? `SIG-${params.refPrefix}-DIR` : void 0
    }
  ];
  return { steps, currentStepNumber, currentActiveRole };
}
function syncApprovalHubData(draft) {
  const configs = ensureWorkflowConfigs(draft);
  if (!draft.approvalHubItems) {
    draft.approvalHubItems = {};
  }
  if (!draft.approvalNotifications) {
    draft.approvalNotifications = [];
  }
  const tors = draft.tors || [];
  const cashAdvances = draft.cashAdvances || [];
  const meetingMinutes = draft.meetingMinutes || [];
  const docList = draft.activityDocumentationList || Object.values(draft.activityDocumentations || {});
  const monReports = Object.values(draft.monitoringReports || {});
  const validItemIds = /* @__PURE__ */ new Set([
    ...tors.map((t) => `apv-tor-${t.id}`),
    ...cashAdvances.map((ca) => `apv-ca-${ca.id}`),
    ...cashAdvances.filter((ca) => ca.isReported).map((ca) => `apv-finrep-${ca.id}`),
    ...meetingMinutes.map((mm) => `apv-mm-${mm.id}`),
    ...docList.filter(Boolean).map((d) => `apv-doc-${d.id}`),
    ...monReports.filter((m) => m.toolId === "EXEC-SUMMARY").map((m) => `apv-exec-${m.id}`)
  ]);
  for (const existingKey of Object.keys(draft.approvalHubItems)) {
    if (!validItemIds.has(existingKey)) {
      delete draft.approvalHubItems[existingKey];
    }
  }
  draft.approvalNotifications = (draft.approvalNotifications || []).filter(
    (n) => Boolean(draft.approvalHubItems?.[n.approvalItemId]) || Boolean(n.approvalItemId?.startsWith("raci-"))
  );
  for (const tor of tors) {
    const itemId = `apv-tor-${tor.id}`;
    const hier = resolveHierarchyAndMonitoring(draft, tor);
    const raci = resolveDynamicRaciForOutput(
      draft,
      hier.outputId,
      tor.picId || tor.createdById,
      tor.picName || tor.createdByName
    );
    const existing = draft.approvalHubItems[itemId];
    let mappedStatus = existing?.status || "Pending Verification";
    if (tor.isArchivedCompleted || existing?.status === "Archived") {
      mappedStatus = "Archived";
    } else if (tor.submissionStatus === "Draft") {
      mappedStatus = "Draft";
    } else if (tor.submissionStatus === "Diajukan" || tor.submissionStatus === "Menunggu Persetujuan Finance") {
      mappedStatus = "Pending Verification";
    } else if (tor.submissionStatus === "Menunggu Persetujuan Director") {
      mappedStatus = "Approved";
    } else if (tor.submissionStatus === "Disetujui") {
      mappedStatus = "Reported to Director";
    } else if (tor.submissionStatus === "Perlu Perbaikan") {
      mappedStatus = "Revision Required";
    } else if (tor.submissionStatus === "Ditolak") {
      mappedStatus = "Rejected";
    }
    const wfConfig = configs["tor"];
    const stepInfo = buildStepsForStatus({
      categoryCode: "tor",
      status: mappedStatus,
      ...raci,
      submittedAt: tor.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
      verifiedAt: tor.updatedAt,
      verifiedNotes: existing?.steps?.[1]?.notes || (mappedStatus === "Approved" || mappedStatus === "Reported to Director" ? "Dokumen ToR telah diperiksa dan disetujui oleh A1 (Accountable Program)." : void 0),
      completedAt: tor.publishedAt || tor.updatedAt,
      directorNotes: existing?.steps?.[2]?.notes || (mappedStatus === "Reported to Director" ? "Laporan ToR telah diterima dan dicatat oleh Direktur." : void 0),
      refPrefix: tor.id.toUpperCase()
    });
    const defaultTimeline = existing?.timeline?.length ? existing.timeline : [
      {
        id: `tl-${itemId}-1`,
        timestamp: tor.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
        actorId: raci.responsibleUserId,
        actorName: raci.responsibleUserName,
        actorRoleCode: "R",
        actorRoleTitle: "Responsible (Pelaksana Kegiatan)",
        responsibleName: raci.responsibleUserName,
        actionLabel: "Mengajukan Dokumen ToR",
        resultingStatus: "Pending Verification",
        comment: `Pengajuan Terms of Reference (${tor.torNumber}) untuk kegiatan ${hier.activityName}.`,
        version: 1
      },
      ...mappedStatus === "Approved" || mappedStatus === "Reported to Director" ? [
        {
          id: `tl-${itemId}-2`,
          timestamp: tor.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
          actorId: raci.accountableProgramUserId,
          actorName: raci.accountableProgramUserName,
          actorRoleCode: "A1",
          actorRoleTitle: "Accountable Program",
          responsibleName: raci.responsibleUserName,
          actionLabel: "Menyetujui ToR (Tahap A1)",
          resultingStatus: "Approved",
          comment: "Substansi program, indikator Output, dan rencana monitoring kegiatan sesuai standar.",
          version: 1
        }
      ] : [],
      ...mappedStatus === "Reported to Director" ? [
        {
          id: `tl-${itemId}-3`,
          timestamp: tor.publishedAt || tor.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
          actorId: raci.directorUserId,
          actorName: raci.directorUserName,
          actorRoleCode: "Direktur",
          actorRoleTitle: "Executive Director",
          responsibleName: raci.responsibleUserName,
          actionLabel: "Menerima Laporan ToR (Dilaporkan ke Direktur)",
          resultingStatus: "Reported to Director",
          comment: "Telah dilaporkan kepada Direktur dan resmi diterbitkan untuk pelaksanaan kegiatan.",
          version: 1
        }
      ] : []
    ];
    if (tor.editRequestStatus === "pending" && stepInfo.steps[2]) {
      stepInfo.currentStepNumber = 3;
      stepInfo.currentActiveRole = "Direktur";
      stepInfo.steps[2] = {
        ...stepInfo.steps[2],
        status: "Sedang Berjalan",
        receivedAt: tor.editRequestedAt || tor.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
        notes: `Permintaan Akses Edit ToR dari ${tor.editRequestedByName || raci.responsibleUserName}: "${tor.editRequestReason || "-"}"`
      };
    }
    draft.approvalHubItems[itemId] = {
      id: itemId,
      sourceEntityId: tor.id,
      sourceTorId: tor.id,
      referenceNumber: tor.torNumber,
      title: tor.title,
      groupType: "program_documents",
      categoryCode: "tor",
      categoryLabel: CATEGORY_META.tor.label,
      ...hier,
      ...raci,
      status: mappedStatus,
      currentStepNumber: stepInfo.currentStepNumber,
      currentActiveRole: stepInfo.currentActiveRole,
      workflowMechanism: existing?.workflowMechanism || wfConfig.mechanism,
      parallelRule: existing?.parallelRule || wfConfig.parallelRule,
      steps: stepInfo.steps,
      timeline: defaultTimeline,
      version: existing?.version || 1,
      isLocked: tor.editRequestStatus === "approved" ? false : mappedStatus === "Approved" || mappedStatus === "Reported to Director" || mappedStatus === "Archived",
      submittedAt: existing?.submittedAt || tor.createdAt,
      dueDate: tor.reportingDeadline,
      completedAt: mappedStatus === "Reported to Director" ? tor.publishedAt || tor.updatedAt : existing?.completedAt,
      isArchived: mappedStatus === "Archived",
      previewData: {
        summaryText: tor.background || tor.objectives || `Terms of Reference pelaksanaan kegiatan ${hier.activityName}.`,
        location: tor.location,
        activityPeriod: `${tor.startDate} s/d ${tor.endDate}`,
        attachments: [
          {
            label: `Dokumen Utama ToR (${tor.torNumber})`,
            url: `#tor-preview-${tor.id}`,
            refCode: tor.torNumber
          },
          ...hier.monitoringTools.filter((t) => t.toolUrl).map((t) => ({
            label: `Monitoring Tool: [${t.toolId}] ${t.toolName}`,
            url: t.toolUrl || "",
            refCode: t.toolId
          }))
        ],
        keyHighlights: [
          { label: "Tujuan Kegiatan", value: tor.generalObjective || tor.objectives || "-" },
          { label: "Lokasi & Periode", value: `${tor.location} (${tor.startDate} \u2013 ${tor.endDate})` },
          {
            label: "Estimasi Pagu Anggaran ToR",
            value: `Rp ${Number(tor.budgetApproved || tor.budgetRequested || 0).toLocaleString("id-ID")}`
          },
          {
            label: "Batas Waktu Pelaporan",
            value: tor.reportingDeadline || "-"
          }
        ],
        editRequestStatus: tor.editRequestStatus || "none",
        editRequestedById: tor.editRequestedById,
        editRequestedByName: tor.editRequestedByName,
        editRequestedByRole: tor.editRequestedByRole,
        editRequestedAt: tor.editRequestedAt,
        editRequestReason: tor.editRequestReason,
        editReviewedByName: tor.editReviewedByName,
        editReviewedAt: tor.editReviewedAt,
        editReviewComment: tor.editReviewComment
      },
      updatedAt: existing?.updatedAt || tor.updatedAt || tor.createdAt
    };
  }
  for (const ca of cashAdvances) {
    const parentTor = tors.find((t) => t.id === ca.torId) || tors[0];
    if (!parentTor) continue;
    const itemId = `apv-ca-${ca.id}`;
    const hier = resolveHierarchyAndMonitoring(draft, parentTor);
    const raci = resolveDynamicRaciForOutput(
      draft,
      hier.outputId,
      ca.requesterId || parentTor.picId,
      ca.requesterName || parentTor.picName
    );
    const existing = draft.approvalHubItems[itemId];
    let mappedStatus = existing?.status || "Pending Verification";
    if (existing?.status === "Archived") {
      mappedStatus = "Archived";
    } else if (ca.status === "Draft") {
      mappedStatus = "Draft";
    } else if (ca.status === "Diajukan") {
      mappedStatus = "Pending Verification";
    } else if (ca.status === "Diverifikasi Finance") {
      mappedStatus = "Pending Approval";
    } else if (ca.status === "Disetujui" || ca.status === "Dicairkan") {
      mappedStatus = "Approved";
    } else if (ca.status === "Perlu Perbaikan") {
      mappedStatus = "Revision Required";
    } else if (ca.status === "Ditolak") {
      mappedStatus = "Rejected";
    }
    const wfConfig = configs["cash_advance"];
    const stepInfo = buildStepsForStatus({
      categoryCode: "cash_advance",
      status: mappedStatus,
      ...raci,
      submittedAt: ca.requestDate || ca.createdAt,
      verifiedAt: ca.signatures?.verifiedBy?.date || ca.updatedAt,
      verifiedNotes: ca.signatures?.verifiedBy?.notes || existing?.steps?.[1]?.notes || (mappedStatus === "Pending Approval" || mappedStatus === "Approved" ? "Pos anggaran dan rincian biaya telah diverifikasi oleh A2 (Finance)." : void 0),
      completedAt: ca.signatures?.approvedBy?.date || ca.updatedAt,
      directorNotes: ca.signatures?.approvedBy?.notes || existing?.steps?.[2]?.notes || (mappedStatus === "Approved" ? "Pengajuan Cash Advance disetujui oleh Direktur untuk pencairan dana." : void 0),
      refPrefix: ca.id.toUpperCase()
    });
    const isDisbursed = Boolean(
      ca.status === "Dicairkan" || ca.signatures?.disbursedBy?.isDisbursed
    );
    const disbursedByName = ca.signatures?.disbursedBy?.name || "Ratna Sari";
    const disbursedAt = ca.signatures?.disbursedBy?.date || ca.updatedAt;
    const transferRef = ca.signatures?.disbursedBy?.transferReference;
    const bankSource = ca.signatures?.disbursedBy?.bankSource;
    const defaultTimeline = existing?.timeline?.length ? existing.timeline : [
      {
        id: `tl-${itemId}-1`,
        timestamp: ca.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
        actorId: raci.responsibleUserId,
        actorName: raci.responsibleUserName,
        actorRoleCode: "R",
        actorRoleTitle: "Responsible (Pemohon Dana)",
        responsibleName: raci.responsibleUserName,
        actionLabel: "Mengajukan Cash Advance Request",
        resultingStatus: "Pending Verification",
        comment: `Pengajuan uang muka operasional ${ca.advanceNumber} sebesar Rp ${Number(ca.totalAmount || 0).toLocaleString("id-ID")}.`,
        version: 1
      },
      ...mappedStatus === "Pending Approval" || mappedStatus === "Approved" ? [
        {
          id: `tl-${itemId}-2`,
          timestamp: ca.signatures?.verifiedBy?.date || ca.updatedAt,
          actorId: raci.accountableFinanceUserId,
          actorName: raci.accountableFinanceUserName,
          actorRoleCode: "A2",
          actorRoleTitle: "Accountable Finance",
          responsibleName: raci.responsibleUserName,
          actionLabel: "Memverifikasi Cash Advance (Tahap A2)",
          resultingStatus: "Pending Approval",
          comment: ca.signatures?.verifiedBy?.notes || "Kode anggaran, rincian biaya, dan kepatuhan dokumen pendukung telah terverifikasi.",
          version: 1
        }
      ] : [],
      ...mappedStatus === "Approved" ? [
        {
          id: `tl-${itemId}-3`,
          timestamp: ca.signatures?.approvedBy?.date || ca.updatedAt,
          actorId: raci.directorUserId,
          actorName: raci.directorUserName,
          actorRoleCode: "Direktur",
          actorRoleTitle: "Executive Director",
          responsibleName: raci.responsibleUserName,
          actionLabel: "Menyetujui Akhir Cash Advance (Direktur)",
          resultingStatus: "Approved",
          comment: ca.signatures?.approvedBy?.notes || "Disetujui akhir oleh Direktur Eksekutif.",
          version: 1
        }
      ] : [],
      ...isDisbursed ? [
        {
          id: `tl-${itemId}-4`,
          timestamp: disbursedAt || ca.updatedAt,
          actorId: raci.accountableFinanceUserId,
          actorName: disbursedByName,
          actorRoleCode: "A2",
          actorRoleTitle: "Kasir / Finance Officer",
          responsibleName: raci.responsibleUserName,
          actionLabel: "Mencairkan Dana Cash Advance ke Pengaju (Finance)",
          resultingStatus: "Approved",
          comment: `Dana sebesar Rp ${Number(ca.totalAmount || 0).toLocaleString("id-ID")} telah dicairkan ke rekening ${ca.bankName} (${ca.bankAccountNumber} a.n. ${ca.bankAccountHolder})${transferRef ? ` \u2014 Ref: ${transferRef}` : ""}.`,
          version: 1
        }
      ] : []
    ];
    draft.approvalHubItems[itemId] = {
      id: itemId,
      sourceEntityId: ca.id,
      sourceTorId: parentTor.id,
      sourceCashAdvanceId: ca.id,
      referenceNumber: ca.advanceNumber,
      title: `Cash Advance: ${ca.activityTitle || parentTor.title}`,
      groupType: "financial_documents",
      categoryCode: "cash_advance",
      categoryLabel: CATEGORY_META.cash_advance.label,
      ...hier,
      ...raci,
      status: mappedStatus,
      currentStepNumber: stepInfo.currentStepNumber,
      currentActiveRole: stepInfo.currentActiveRole,
      workflowMechanism: existing?.workflowMechanism || wfConfig.mechanism,
      parallelRule: existing?.parallelRule || wfConfig.parallelRule,
      steps: stepInfo.steps,
      timeline: defaultTimeline,
      version: existing?.version || 1,
      isLocked: mappedStatus === "Approved" || mappedStatus === "Archived",
      submittedAt: existing?.submittedAt || ca.requestDate || ca.createdAt,
      dueDate: ca.reportingDeadlineDate || parentTor.reportingDeadline,
      completedAt: mappedStatus === "Approved" ? ca.signatures?.approvedBy?.date || ca.updatedAt : existing?.completedAt,
      isArchived: mappedStatus === "Archived",
      previewData: {
        summaryText: ca.implementationTimelineSummary || `Pengajuan dana operasional untuk kegiatan ${ca.activityTitle} (${ca.location}).`,
        location: ca.location,
        activityPeriod: `${ca.activityStartDate} s/d ${ca.activityEndDate}`,
        purposeOfFunds: ca.implementationTimelineSummary || `Pembiayaan pelaksanaan aktivitas lapangan pada ${ca.activityTitle} sesuai ToR ${ca.torNumber}.`,
        budgetLines: (ca.items || []).map((it) => ({
          code: it.budgetCode || "1.1.1",
          description: `${it.description} (${it.volume} ${it.unit} \xD7 ${it.frequency} ${it.frequencyUnit || "Kali"})`,
          amount: Number(it.totalAmount) || 0
        })),
        requestedAmount: Number(ca.totalAmount) || 0,
        plannedUsageDate: `${ca.activityStartDate} s/d ${ca.activityEndDate}`,
        plannedSettlementDate: ca.reportingDeadlineDate || parentTor.reportingDeadline || "-",
        isDisbursed,
        disbursedByName: isDisbursed ? disbursedByName : void 0,
        disbursedAt: isDisbursed ? disbursedAt : void 0,
        transferReference: isDisbursed ? transferRef : void 0,
        bankSource: isDisbursed ? bankSource : void 0,
        attachments: [
          {
            label: `Referensi Dokumen ToR (${ca.torNumber})`,
            url: `#tor-ref-${parentTor.id}`,
            refCode: ca.torNumber
          },
          {
            label: `Rincian Anggaran & Rekening Tujuan (${ca.bankName} - ${ca.bankAccountNumber})`,
            url: `#ca-items-${ca.id}`,
            refCode: ca.advanceNumber
          }
        ]
      },
      updatedAt: existing?.updatedAt || ca.updatedAt || ca.createdAt
    };
    if (ca.isReported) {
      const finItemId = `apv-finrep-${ca.id}`;
      const existingFin = draft.approvalHubItems[finItemId];
      const approvedAmt = Number(ca.totalAmount) || 0;
      const realizedAmt = typeof ca.realizedAmount === "number" ? ca.realizedAmount : (ca.items || []).reduce(
        (acc, it) => acc + (typeof it.actualSpent === "number" ? it.actualSpent : Number(it.totalAmount) || 0),
        0
      );
      const diffAmt = approvedAmt - realizedAmt;
      const remainingAmt = diffAmt > 0 ? diffAmt : 0;
      let finStatus = existingFin?.status || "Pending Verification";
      if (existingFin?.status === "Archived") {
        finStatus = "Archived";
      } else if (ca.reportApprovalStatus === "Menunggu Pemeriksaan Finance") {
        finStatus = "Pending Verification";
      } else if (ca.reportApprovalStatus === "Menunggu Persetujuan Director") {
        finStatus = "Pending Approval";
      } else if (ca.reportApprovalStatus === "Telah Disetujui") {
        finStatus = "Approved";
      } else if (ca.reportApprovalStatus === "Perlu Revisi") {
        finStatus = "Revision Required";
      } else if (ca.reportApprovalStatus === "Ditolak") {
        finStatus = "Rejected";
      } else if (!ca.reportApprovalStatus) {
        finStatus = existingFin?.status || "Approved";
      }
      const finWfConfig = configs["laporan_keuangan_akhir"];
      const finRefNumber = ca.advanceNumber.replace(/^CA\//, "LPJ-FIN/");
      const finStepInfo = buildStepsForStatus({
        categoryCode: "laporan_keuangan_akhir",
        status: finStatus,
        ...raci,
        submittedAt: ca.reportedAt || ca.updatedAt,
        verifiedAt: ca.reportVerifiedAt || ca.updatedAt,
        verifiedNotes: ca.reportVerifiedNotes || existingFin?.steps?.[1]?.notes || (finStatus === "Pending Approval" || finStatus === "Approved" ? "Bukti transaksi, nota pengeluaran, dan lampiran PDF Expensify telah diverifikasi oleh A2." : void 0),
        completedAt: ca.reportApprovedAt || ca.updatedAt,
        directorNotes: ca.reportApprovedNotes || existingFin?.steps?.[2]?.notes || (finStatus === "Approved" ? "Laporan Keuangan Akhir telah disetujui akhir oleh Direktur." : void 0),
        refPrefix: `FIN-${ca.id.toUpperCase()}`
      });
      const finTimeline = existingFin?.timeline?.length && existingFin.status === finStatus ? existingFin.timeline : [
        {
          id: `tl-${finItemId}-1`,
          timestamp: ca.reportedAt || ca.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
          actorId: raci.responsibleUserId,
          actorName: raci.responsibleUserName,
          actorRoleCode: "R",
          actorRoleTitle: "Responsible (Pelaksana Kegiatan)",
          responsibleName: raci.responsibleUserName,
          actionLabel: "Mengonfirmasi & Mengajukan Laporan Keuangan Akhir",
          resultingStatus: finStatus === "Draft" ? "Draft" : "Pending Verification",
          comment: ca.reportNotes || `Konfirmasi realisasi pengeluaran Rp ${realizedAmt.toLocaleString("id-ID")} dari pagu Cash Advance Rp ${approvedAmt.toLocaleString("id-ID")}.`,
          version: 1
        },
        ...finStatus === "Pending Approval" || finStatus === "Approved" ? [
          {
            id: `tl-${finItemId}-2`,
            timestamp: ca.reportVerifiedAt || ca.updatedAt,
            actorId: raci.accountableFinanceUserId,
            actorName: raci.accountableFinanceUserName,
            actorRoleCode: "A2",
            actorRoleTitle: "Accountable Finance",
            responsibleName: raci.responsibleUserName,
            actionLabel: "Memverifikasi Laporan Keuangan Akhir (Tahap A2)",
            resultingStatus: "Pending Approval",
            comment: ca.reportVerifiedNotes || "Bukti transaksi, rekonsiliasi sisa dana, dan lampiran Expensify sesuai.",
            version: 1
          }
        ] : [],
        ...finStatus === "Approved" ? [
          {
            id: `tl-${finItemId}-3`,
            timestamp: ca.reportApprovedAt || ca.updatedAt,
            actorId: raci.directorUserId,
            actorName: raci.directorUserName,
            actorRoleCode: "Direktur",
            actorRoleTitle: "Executive Director",
            responsibleName: raci.responsibleUserName,
            actionLabel: "Menyetujui Akhir Laporan Keuangan (Direktur)",
            resultingStatus: "Approved",
            comment: ca.reportApprovedNotes || "Laporan pertanggungjawaban keuangan akhir disetujui dan ditutup.",
            version: 1
          }
        ] : []
      ];
      draft.approvalHubItems[finItemId] = {
        id: finItemId,
        sourceEntityId: ca.id,
        sourceTorId: parentTor.id,
        sourceCashAdvanceId: ca.id,
        referenceNumber: finRefNumber,
        title: `Laporan Keuangan Akhir: ${ca.activityTitle}`,
        groupType: "financial_documents",
        categoryCode: "laporan_keuangan_akhir",
        categoryLabel: CATEGORY_META.laporan_keuangan_akhir.label,
        ...hier,
        ...raci,
        status: finStatus,
        currentStepNumber: finStepInfo.currentStepNumber,
        currentActiveRole: finStepInfo.currentActiveRole,
        workflowMechanism: existingFin?.workflowMechanism || finWfConfig.mechanism,
        parallelRule: existingFin?.parallelRule || finWfConfig.parallelRule,
        steps: finStepInfo.steps,
        timeline: finTimeline,
        version: existingFin?.version || 1,
        isLocked: finStatus === "Approved" || finStatus === "Archived",
        submittedAt: existingFin?.submittedAt || ca.reportedAt || ca.updatedAt,
        dueDate: ca.reportingDeadlineDate || parentTor.reportingDeadline,
        completedAt: finStatus === "Approved" ? ca.reportApprovedAt || ca.updatedAt : existingFin?.completedAt,
        isArchived: finStatus === "Archived",
        previewData: {
          summaryText: ca.reportNotes || `Laporan pertanggungjawaban keuangan akhir atas Cash Advance ${ca.advanceNumber}.`,
          location: ca.location,
          activityPeriod: `${ca.activityStartDate} s/d ${ca.activityEndDate}`,
          cashAdvanceReferenceNumber: ca.advanceNumber,
          approvedAmount: approvedAmt,
          realizedAmount: realizedAmt,
          budgetVariance: diffAmt,
          remainingFunds: remainingAmt,
          varianceExplanation: ca.reportNotes || (diffAmt === 0 ? "Realisasi pengeluaran 100% sesuai dengan rincian anggaran Cash Advance yang disetujui." : diffAmt > 0 ? `Terdapat efisiensi/sisa dana sebesar Rp ${diffAmt.toLocaleString("id-ID")} yang telah dikembalikan ke kas organisasi.` : `Terdapat selisih kurang (minus) sebesar Rp ${Math.abs(diffAmt).toLocaleString("id-ID")} karena penyesuaian kebutuhan riil di lapangan.`),
          expensifyPdfLink: ca.expensifyPdfLink || "https://drive.google.com/file/d/expensify-verified-receipts/view",
          attachments: [
            {
              label: `Bukti Transaksi & PDF Expensify (${finRefNumber})`,
              url: ca.expensifyPdfLink || "https://drive.google.com/file/d/expensify-verified-receipts/view",
              refCode: ca.advanceNumber
            },
            {
              label: `Referensi Cash Advance (${ca.advanceNumber})`,
              url: `#ca-ref-${ca.id}`,
              refCode: ca.advanceNumber
            }
          ]
        },
        updatedAt: existingFin?.updatedAt || ca.updatedAt
      };
    }
  }
  for (const mm of meetingMinutes) {
    const parentTor = tors.find((t) => t.id === mm.torId || t.torNumber === mm.torNumber) || tors[0];
    if (!parentTor) continue;
    const itemId = `apv-notulen-${mm.id}`;
    const hier = resolveHierarchyAndMonitoring(draft, parentTor);
    const raci = resolveDynamicRaciForOutput(
      draft,
      hier.outputId,
      mm.createdById || parentTor.picId,
      mm.recorderName || mm.createdByName || parentTor.picName
    );
    const existing = draft.approvalHubItems[itemId];
    const mappedStatus = existing?.status || "Pending Verification";
    const wfConfig = configs["notulen"];
    const stepInfo = buildStepsForStatus({
      categoryCode: "notulen",
      status: mappedStatus,
      ...raci,
      submittedAt: mm.createdAt,
      verifiedAt: mm.updatedAt,
      refPrefix: mm.id.toUpperCase()
    });
    const defaultTimeline = existing?.timeline?.length ? existing.timeline : [
      {
        id: `tl-${itemId}-1`,
        timestamp: mm.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
        actorId: raci.responsibleUserId,
        actorName: raci.responsibleUserName,
        actorRoleCode: "R",
        actorRoleTitle: "Responsible (Notulis / Pelaksana)",
        responsibleName: raci.responsibleUserName,
        actionLabel: "Mengajukan Notulen Rapat",
        resultingStatus: "Pending Verification",
        comment: `Notulen "${mm.title}" (${mm.documentNumber}) diajukan untuk diverifikasi oleh A1.`,
        version: 1
      }
    ];
    draft.approvalHubItems[itemId] = {
      id: itemId,
      sourceEntityId: mm.id,
      sourceTorId: parentTor.id,
      sourceCashAdvanceId: mm.cashAdvanceId,
      referenceNumber: mm.documentNumber,
      title: mm.title,
      groupType: "program_documents",
      categoryCode: "notulen",
      categoryLabel: CATEGORY_META.notulen.label,
      ...hier,
      ...raci,
      status: mappedStatus,
      currentStepNumber: stepInfo.currentStepNumber,
      currentActiveRole: stepInfo.currentActiveRole,
      workflowMechanism: existing?.workflowMechanism || wfConfig.mechanism,
      parallelRule: existing?.parallelRule || wfConfig.parallelRule,
      steps: stepInfo.steps,
      timeline: defaultTimeline,
      version: existing?.version || 1,
      isLocked: mappedStatus === "Approved" || mappedStatus === "Reported to Director" || mappedStatus === "Archived",
      submittedAt: existing?.submittedAt || mm.createdAt,
      dueDate: parentTor.reportingDeadline,
      completedAt: existing?.completedAt,
      isArchived: mappedStatus === "Archived",
      previewData: {
        summaryText: mm.discussions?.[0]?.summary || `Notulen rapat kegiatan ${mm.title} pada ${mm.meetingDate} di ${mm.meetingLocation}.`,
        location: `${mm.meetingLocation} (${mm.meetingRoomPlatform})`,
        activityPeriod: `${mm.meetingDate} \xB7 ${mm.startTime}\u2013${mm.endTime}`,
        attachments: [
          {
            label: `Dokumen Notulen Rapat (${mm.documentNumber})`,
            url: `#notulen-${mm.id}`,
            refCode: mm.documentNumber
          }
        ],
        keyHighlights: [
          {
            label: "Peserta & Pencatat",
            value: `${(mm.participants || []).length} Peserta \xB7 Notulis: ${mm.recorderName}`
          },
          {
            label: "Pokok Pembahasan",
            value: (mm.discussions || []).map((d) => d.topic).join("; ") || "-"
          },
          {
            label: "Keputusan Rapat",
            value: (mm.decisions || []).map((d) => d.statement).join("; ") || "-"
          },
          {
            label: "Rencana Tindak Lanjut",
            value: `${(mm.actionPoints || []).length} Butir Tindak Lanjut (Action Points)`
          }
        ]
      },
      updatedAt: existing?.updatedAt || mm.updatedAt || mm.createdAt
    };
  }
  for (const doc of docList) {
    if (!doc || !doc.torId) continue;
    const parentTor = tors.find((t) => t.id === doc.torId) || tors[0];
    if (!parentTor) continue;
    const itemId = `apv-doc-${doc.id}`;
    const hier = resolveHierarchyAndMonitoring(draft, parentTor);
    const raci = resolveDynamicRaciForOutput(
      draft,
      hier.outputId,
      doc.updatedById || parentTor.picId,
      doc.updatedByName || parentTor.picName
    );
    const existing = draft.approvalHubItems[itemId];
    const isSeededDoc = doc.id === "doc-act-tor-1" || doc.id.startsWith("doc-seed-");
    const mappedStatus = existing?.status || (isSeededDoc ? "Approved" : "Pending Verification");
    const wfConfig = configs["dokumentasi"];
    const refNumber = doc.documentNumber || parentTor.torNumber.replace(/^TOR\//, "DOK/");
    const stepInfo = buildStepsForStatus({
      categoryCode: "dokumentasi",
      status: mappedStatus,
      ...raci,
      submittedAt: doc.createdAt,
      verifiedAt: doc.updatedAt,
      verifiedNotes: existing?.steps?.[1]?.notes || (mappedStatus === "Approved" || mappedStatus === "Reported to Director" ? "Dokumentasi foto terbaik, Human Interest Story, dan tautan bukti kegiatan telah diverifikasi oleh A1." : void 0),
      directorNotes: existing?.steps?.[2]?.notes,
      refPrefix: doc.id.toUpperCase()
    });
    const defaultTimeline = existing?.timeline?.length ? existing.timeline : [
      {
        id: `tl-${itemId}-1`,
        timestamp: doc.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
        actorId: raci.responsibleUserId,
        actorName: raci.responsibleUserName,
        actorRoleCode: "R",
        actorRoleTitle: "Responsible (Pelaksana Kegiatan)",
        responsibleName: raci.responsibleUserName,
        actionLabel: "Mengajukan Dokumentasi Kegiatan",
        resultingStatus: "Pending Verification",
        comment: `Pengajuan paket dokumentasi kegiatan "${doc.activityTitle}" (${(doc.bestPhotos || []).length} Foto Terbaik & ${(doc.humanInterestStories || []).length} Human Interest Story).`,
        version: 1
      },
      ...mappedStatus === "Approved" || mappedStatus === "Reported to Director" ? [
        {
          id: `tl-${itemId}-2`,
          timestamp: doc.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
          actorId: raci.accountableProgramUserId,
          actorName: raci.accountableProgramUserName,
          actorRoleCode: "A1",
          actorRoleTitle: "Accountable Program",
          responsibleName: raci.responsibleUserName,
          actionLabel: "Memverifikasi & Menyetujui Dokumentasi (Tahap A1)",
          resultingStatus: "Approved",
          comment: "Kelengkapan foto lapangan, atribusi fotografer, dan narasi cerita telah sesuai.",
          version: 1
        }
      ] : []
    ];
    draft.approvalHubItems[itemId] = {
      id: itemId,
      sourceEntityId: doc.id,
      sourceTorId: parentTor.id,
      referenceNumber: refNumber,
      title: `Dokumentasi: ${doc.activityTitle || parentTor.title}`,
      groupType: "program_documents",
      categoryCode: "dokumentasi",
      categoryLabel: CATEGORY_META.dokumentasi.label,
      ...hier,
      ...raci,
      status: mappedStatus,
      currentStepNumber: stepInfo.currentStepNumber,
      currentActiveRole: stepInfo.currentActiveRole,
      workflowMechanism: existing?.workflowMechanism || wfConfig.mechanism,
      parallelRule: existing?.parallelRule || wfConfig.parallelRule,
      steps: stepInfo.steps,
      timeline: defaultTimeline,
      version: existing?.version || 1,
      isLocked: mappedStatus === "Approved" || mappedStatus === "Reported to Director" || mappedStatus === "Archived",
      submittedAt: existing?.submittedAt || doc.createdAt,
      dueDate: parentTor.reportingDeadline,
      completedAt: existing?.completedAt,
      isArchived: mappedStatus === "Archived",
      previewData: {
        summaryText: doc.bestPhotosStoryTopic || `Dokumentasi visual & Human Interest Story kegiatan ${doc.activityTitle}.`,
        location: parentTor.location,
        activityPeriod: `${parentTor.startDate} s/d ${parentTor.endDate}`,
        attachments: [
          ...(doc.generalPhotoLinks || []).map((g, i) => ({
            label: `Tautan Folder Dokumentasi #${i + 1}`,
            url: g.url,
            refCode: refNumber
          })),
          ...(doc.bestPhotos || []).filter((p) => p.photoLink).slice(0, 3).map((p) => ({
            label: `Foto Terbaik #${p.slotNumber}: ${p.photoNameTitle}`,
            url: p.photoLink,
            refCode: `FOTO-${p.slotNumber}`
          }))
        ],
        keyHighlights: [
          { label: "Topik Cerita Utama", value: doc.bestPhotosStoryTopic || "-" },
          {
            label: "Foto Terbaik Terkurasi",
            value: `${(doc.bestPhotos || []).filter((p) => p.photoLink).length} / 5 Slot Foto Terisi`
          },
          {
            label: "Human Interest Story",
            value: (doc.humanInterestStories || []).map((s) => s.storyTitle).join("; ") || "-"
          }
        ]
      },
      updatedAt: existing?.updatedAt || doc.updatedAt || doc.createdAt
    };
  }
  const execItems = monReports.filter((m) => m.toolId === "EXEC-SUMMARY");
  for (const exec of execItems) {
    const parentTor = tors.find((t) => t.id === exec.torId) || tors[0];
    if (!parentTor) continue;
    const itemId = `apv-exec-${exec.id}`;
    const hier = resolveHierarchyAndMonitoring(draft, parentTor);
    const raci = resolveDynamicRaciForOutput(
      draft,
      hier.outputId,
      exec.responsibleUserId || parentTor.picId,
      exec.responsibleName || parentTor.picName
    );
    const existing = draft.approvalHubItems[itemId];
    let mappedStatus = existing?.status || "Pending Verification";
    if (!existing) {
      if (exec.status === "Planned") mappedStatus = "Draft";
      else if (exec.status === "In Progress") mappedStatus = "Pending Verification";
      else if (exec.status === "Completed") mappedStatus = "Reported to Director";
    }
    const wfConfig = configs["executive_summary"];
    const refNumber = parentTor.torNumber.replace(/^TOR\//, "EXEC/");
    const stepInfo = buildStepsForStatus({
      categoryCode: "executive_summary",
      status: mappedStatus,
      ...raci,
      submittedAt: exec.createdAt,
      verifiedAt: exec.updatedAt,
      verifiedNotes: existing?.steps?.[1]?.notes || (mappedStatus === "Approved" || mappedStatus === "Reported to Director" ? "Ketujuh bagian Executive Summary (Baseline s/d Usulan Implementasi) dan bukti lapangan telah diverifikasi oleh A1." : void 0),
      completedAt: exec.updatedAt,
      directorNotes: existing?.steps?.[2]?.notes || (mappedStatus === "Reported to Director" ? "Executive Summary 7 Hari telah diterima oleh Direktur sebagai laporan akhir kegiatan." : void 0),
      refPrefix: `EXEC-${parentTor.id.toUpperCase()}`
    });
    const defaultTimeline = existing?.timeline?.length ? existing.timeline : [
      {
        id: `tl-${itemId}-1`,
        timestamp: exec.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
        actorId: raci.responsibleUserId,
        actorName: raci.responsibleUserName,
        actorRoleCode: "R",
        actorRoleTitle: "Responsible (Pelaksana Kegiatan)",
        responsibleName: raci.responsibleUserName,
        actionLabel: "Menyusun & Mengajukan Executive Summary",
        resultingStatus: mappedStatus === "Draft" ? "Draft" : "Pending Verification",
        comment: `Pengajuan Executive Summary (7 Bagian Pembelajaran & Bukti MEAL) untuk ${exec.cashAdvanceActivitySummary}.`,
        version: 1
      },
      ...mappedStatus === "Approved" || mappedStatus === "Reported to Director" ? [
        {
          id: `tl-${itemId}-2`,
          timestamp: exec.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
          actorId: raci.accountableProgramUserId,
          actorName: raci.accountableProgramUserName,
          actorRoleCode: "A1",
          actorRoleTitle: "Accountable Program",
          responsibleName: raci.responsibleUserName,
          actionLabel: "Memverifikasi Executive Summary (Tahap A1)",
          resultingStatus: "Approved",
          comment: "Capaian indikator, pembelajaran konteks, dan rekomendasi tindak lanjut telah terverifikasi.",
          version: 1
        }
      ] : [],
      ...mappedStatus === "Reported to Director" ? [
        {
          id: `tl-${itemId}-3`,
          timestamp: exec.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
          actorId: raci.directorUserId,
          actorName: raci.directorUserName,
          actorRoleCode: "Direktur",
          actorRoleTitle: "Executive Director",
          responsibleName: raci.responsibleUserName,
          actionLabel: "Menerima Laporan Executive Summary (Direktur)",
          resultingStatus: "Reported to Director",
          comment: "Executive Summary resmi diterima Direktur sebagai laporan akhir kegiatan 7 hari.",
          version: 1
        }
      ] : []
    ];
    draft.approvalHubItems[itemId] = {
      id: itemId,
      sourceEntityId: exec.id,
      sourceTorId: parentTor.id,
      sourceCashAdvanceId: exec.cashAdvanceId,
      referenceNumber: refNumber,
      title: `Executive Summary: ${exec.timelineActivity || parentTor.title}`,
      groupType: "program_documents",
      categoryCode: "executive_summary",
      categoryLabel: CATEGORY_META.executive_summary.label,
      ...hier,
      ...raci,
      status: mappedStatus,
      currentStepNumber: stepInfo.currentStepNumber,
      currentActiveRole: stepInfo.currentActiveRole,
      workflowMechanism: existing?.workflowMechanism || wfConfig.mechanism,
      parallelRule: existing?.parallelRule || wfConfig.parallelRule,
      steps: stepInfo.steps,
      timeline: defaultTimeline,
      version: existing?.version || 1,
      isLocked: mappedStatus === "Approved" || mappedStatus === "Reported to Director" || mappedStatus === "Archived",
      submittedAt: existing?.submittedAt || exec.createdAt,
      dueDate: parentTor.reportingDeadline,
      completedAt: mappedStatus === "Reported to Director" ? exec.updatedAt : existing?.completedAt,
      isArchived: mappedStatus === "Archived",
      previewData: {
        summaryText: exec.sections?.results?.narrative || exec.sections?.intervention?.narrative || `Ringkasan eksekutif 7 bagian (Baseline, Intervensi, Hasil, Context Learning, Reflection, Participation, UsulanSelanjutnya) untuk ${exec.cashAdvanceActivitySummary}.`,
        location: parentTor.location,
        activityPeriod: exec.timelinePeriod || `${parentTor.startDate} s/d ${parentTor.endDate}`,
        attachments: [
          ...exec.mainEvidenceFolderUrl ? [
            {
              label: "Folder Bukti Utama (Main Evidence Folder)",
              url: exec.mainEvidenceFolderUrl,
              refCode: "EVIDENCE-MAIN"
            }
          ] : [],
          ...hier.monitoringTools.map((t) => ({
            label: `Terhubung Monitoring Tool: [${t.toolId}] ${t.toolName}`,
            url: t.toolUrl || `#tool-${t.toolId}`,
            refCode: t.toolId
          }))
        ],
        keyHighlights: [
          {
            label: "A. Baseline",
            value: exec.sections?.baseline?.narrative || "Data kondisi awal sebelum intervensi kegiatan."
          },
          {
            label: "B. Intervensi & C. Hasil",
            value: exec.sections?.results?.narrative || exec.sections?.intervention?.narrative || "Proses penanganan lapangan dan hasil langsung pasca kegiatan."
          },
          {
            label: "D. Context & E. Reflection Learning",
            value: exec.sections?.reflectionLearning?.narrative || exec.sections?.contextLearning?.narrative || "Pembelajaran konteks lokal dan refleksi tim pelaksana."
          },
          {
            label: "F. Partisipasi & G. Usulan Selanjutnya",
            value: exec.sections?.nextImplementationProposal?.narrative || "Rekomendasi tindak lanjut untuk implementasi tahap berikutnya."
          }
        ]
      },
      updatedAt: existing?.updatedAt || exec.updatedAt || exec.createdAt
    };
  }
  const cleanTitleForNotif = (rawTitle) => (rawTitle || "").replace(
    /^(Cash Advance|Laporan Keuangan Akhir|Dokumentasi|Executive Summary|Notulen Rapat|Notulen|ToR):\s*/i,
    ""
  );
  const sanitizeNotifMessage = (msg) => (msg || "").replace(/^\[[^\]]+\]\s*/, "").replace(
    /"(Cash Advance|Laporan Keuangan Akhir|Dokumentasi|Executive Summary|Notulen Rapat|Notulen|ToR):\s*/gi,
    '"'
  );
  const allItems = Object.values(draft.approvalHubItems);
  if (draft.approvalNotifications.length === 0) {
    for (const item of allItems) {
      const cleanTitle = cleanTitleForNotif(item.title);
      if (item.status === "Pending Verification") {
        const targetId = item.groupType === "program_documents" ? item.accountableProgramUserId : item.accountableFinanceUserId;
        const targetRole = item.groupType === "program_documents" ? "A1" : "A2";
        draft.approvalNotifications.unshift({
          id: `notif-init-${item.id}`,
          approvalItemId: item.id,
          referenceNumber: item.referenceNumber,
          documentTitle: cleanTitle,
          categoryCode: item.categoryCode,
          categoryLabel: item.categoryLabel,
          eventType: "ENTER_VERIFICATION",
          message: `"${cleanTitle}" menunggu verifikasi ${targetRole} (${targetRole === "A1" ? item.accountableProgramUserName : item.accountableFinanceUserName}).`,
          targetUserIds: [targetId],
          targetRoleCodes: [targetRole],
          createdAt: item.updatedAt,
          isReadByUserIds: []
        });
      } else if (item.status === "Pending Approval" || item.status === "Approved" && item.groupType === "program_documents") {
        draft.approvalNotifications.unshift({
          id: `notif-dir-${item.id}`,
          approvalItemId: item.id,
          referenceNumber: item.referenceNumber,
          documentTitle: cleanTitle,
          categoryCode: item.categoryCode,
          categoryLabel: item.categoryLabel,
          eventType: item.groupType === "program_documents" ? "APPROVED" : "ENTER_VERIFICATION",
          message: item.groupType === "program_documents" ? `"${cleanTitle}" telah disetujui A1 (${item.accountableProgramUserName}) dan dilaporkan kepada Direktur.` : `"${cleanTitle}" telah diverifikasi A2 (${item.accountableFinanceUserName}) dan menunggu Persetujuan Akhir Direktur.`,
          targetUserIds: [item.directorUserId, item.responsibleUserId],
          targetRoleCodes: ["Direktur", "R"],
          createdAt: item.updatedAt,
          isReadByUserIds: []
        });
      } else if (item.status === "Reported to Director" || item.status === "Approved" && item.groupType === "financial_documents") {
        draft.approvalNotifications.unshift({
          id: `notif-done-${item.id}`,
          approvalItemId: item.id,
          referenceNumber: item.referenceNumber,
          documentTitle: cleanTitle,
          categoryCode: item.categoryCode,
          categoryLabel: item.categoryLabel,
          eventType: "FINAL_COMPLETED",
          message: item.groupType === "program_documents" ? `"${cleanTitle}" telah disetujui A1 & diterima Direktur. Silakan lanjutkan pelaksanaan kegiatan.` : `"${cleanTitle}" telah disetujui akhir oleh Direktur. Dana & dokumen siap ditindaklanjuti.`,
          targetUserIds: [item.responsibleUserId],
          targetRoleCodes: ["R"],
          createdAt: item.updatedAt,
          isReadByUserIds: []
        });
      } else if (item.status === "Revision Required") {
        const latestRevComment = item.timeline?.[0]?.comment || "Mohon perbaiki dokumen sesuai catatan pemeriksa.";
        draft.approvalNotifications.unshift({
          id: `notif-rev-${item.id}`,
          approvalItemId: item.id,
          referenceNumber: item.referenceNumber,
          documentTitle: cleanTitle,
          categoryCode: item.categoryCode,
          categoryLabel: item.categoryLabel,
          eventType: "REVISION_REQUIRED",
          message: `"${cleanTitle}" dikembalikan untuk perbaikan: "${latestRevComment}".`,
          targetUserIds: [item.responsibleUserId],
          targetRoleCodes: ["R"],
          createdAt: item.updatedAt,
          isReadByUserIds: []
        });
      } else if (item.status === "Rejected") {
        draft.approvalNotifications.unshift({
          id: `notif-rej-${item.id}`,
          approvalItemId: item.id,
          referenceNumber: item.referenceNumber,
          documentTitle: cleanTitle,
          categoryCode: item.categoryCode,
          categoryLabel: item.categoryLabel,
          eventType: "REJECTED",
          message: `"${cleanTitle}" ditolak. Periksa catatan pemeriksa untuk tindak lanjut.`,
          targetUserIds: [item.responsibleUserId],
          targetRoleCodes: ["R"],
          createdAt: item.updatedAt,
          isReadByUserIds: []
        });
      }
    }
  }
  const seenNotifKeys = /* @__PURE__ */ new Set();
  const dedupedNotifications = [];
  for (const notif of draft.approvalNotifications || []) {
    notif.message = sanitizeNotifMessage(notif.message);
    if (notif.documentTitle) {
      notif.documentTitle = cleanTitleForNotif(notif.documentTitle);
    }
    const normTargets = [...notif.targetUserIds || []].sort().join(",");
    const dedupeKey = `${notif.approvalItemId}|${notif.eventType}|${normTargets}|${notif.message}`;
    const initKey = `${notif.approvalItemId}|${notif.eventType}|${normTargets}`;
    if (seenNotifKeys.has(dedupeKey) || notif.eventType === "ENTER_VERIFICATION" && seenNotifKeys.has(initKey)) {
      continue;
    }
    seenNotifKeys.add(dedupeKey);
    seenNotifKeys.add(initKey);
    dedupedNotifications.push(notif);
  }
  draft.approvalNotifications = dedupedNotifications;
  const sortedItems = allItems.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  const sortedNotifications = [...draft.approvalNotifications || []].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 60);
  return {
    items: sortedItems,
    configs,
    notifications: sortedNotifications
  };
}
function resolveUserApprovalAccess(draft, user, allItems) {
  const items = allItems || Object.values(draft.approvalHubItems || {});
  const raciList = Object.values(draft.outputRaciRecords || {});
  const isActiveUser = user.isActive !== false;
  const isAdmin = user.role === "admin";
  const isDirector = isActiveUser && !isAdmin && (user.role === "director" || items.some((i) => i.directorUserId === user.id));
  const isFinance = isActiveUser && !isAdmin && user.role === "finance";
  const isAssignedA1 = raciList.some((r) => r.accountableUserId === user.id) || items.some((i) => i.accountableProgramUserId === user.id);
  const isA1 = isActiveUser && !isAdmin && isAssignedA1 && user.permissions?.canApproveTor !== false;
  const isAssignedA2 = raciList.some((r) => r.accountableFinanceUserId === user.id) || items.some((i) => i.accountableFinanceUserId === user.id);
  const isA2 = isActiveUser && isAssignedA2 && !isAdmin && user.permissions?.canApproveTor !== false;
  const isR = isActiveUser && !isAdmin && (raciList.some((r) => r.responsibleUserId === user.id) || items.some((i) => i.responsibleUserId === user.id) || user.role === "staff" || user.role === "meal" || user.role === "program_manager");
  const canAccessApprovalMenu = isActiveUser && !isAdmin && (isA1 || isA2 || isDirector || isFinance || isR);
  const activeApprovalRoles = [];
  if (isDirector) activeApprovalRoles.push("Direktur");
  if (isA1) activeApprovalRoles.push("A1 \u2013 Accountable Program");
  if (isA2) activeApprovalRoles.push("A2 \u2013 Accountable Finance");
  if (isFinance && !isA2) activeApprovalRoles.push("Finance");
  if (isR) activeApprovalRoles.push("R \u2013 Responsible");
  let scopeSummary = "Tidak memiliki akses ke Menu Approval.";
  if (isDirector) {
    scopeSummary = "Direktur: Melihat seluruh pengajuan program & keuangan, persetujuan akhir keuangan, dan penerimaan laporan program.";
  } else if (isA1 && (isA2 || isFinance)) {
    scopeSummary = "A1 & Keuangan: Melihat dokumen program sesuai RACI A1 serta dokumen keuangan.";
  } else if (isA1) {
    scopeSummary = "A1 \u2013 Accountable Program: Hanya melihat, memverifikasi, menyetujui, dan mengembalikan dokumen program sesuai penugasan RACI.";
  } else if (isA2) {
    scopeSummary = "A2 \u2013 Accountable Finance: Hanya melihat, memverifikasi, dan mengembalikan dokumen keuangan yang menjadi tanggung jawabnya.";
  } else if (isFinance) {
    scopeSummary = "Finance: Melihat pengajuan keuangan, memantau verifikasi, dan mengelola pencatatan keuangan (tanpa kewenangan persetujuan otomatis).";
  } else if (isR) {
    scopeSummary = "R \u2013 Responsible: Memantau seluruh perjalanan persetujuan dokumen melalui Tracking Ticket (R \u2192 A1/A2 \u2192 Direktur), berdiskusi dengan pemeriksa, dan menindaklanjuti revisi.";
  }
  return {
    userId: user.id,
    userName: user.name,
    userRole: user.role,
    isA1,
    isA2,
    isDirector,
    isFinance,
    isR,
    isAdmin,
    canAccessApprovalMenu,
    canApproveProgramDocs: !isAdmin && isA1,
    canVerifyFinanceDocs: !isAdmin && isA2,
    canFinalApproveDirector: !isAdmin && isDirector,
    activeApprovalRoles,
    scopeSummary
  };
}
function canUserViewApprovalItem(item, user, access) {
  if (!access.canAccessApprovalMenu) return false;
  if (access.isDirector) {
    return true;
  }
  const isProgramDoc = item.groupType === "program_documents";
  const isFinanceDoc = item.groupType === "financial_documents";
  if (isProgramDoc && access.isA1 && item.accountableProgramUserId === user.id) {
    return true;
  }
  if (isFinanceDoc && access.isA2 && item.accountableFinanceUserId === user.id) {
    return true;
  }
  if (isFinanceDoc && access.isFinance) {
    return true;
  }
  return false;
}
function filterApprovalItemsForUser(items, user, access) {
  if (!access.canAccessApprovalMenu) return [];
  return items.filter((item) => canUserViewApprovalItem(item, user, access));
}
function executeApprovalHubAction(params) {
  const { draft, itemId, actor, action, comment = "" } = params;
  const synced = syncApprovalHubData(draft);
  const item = draft.approvalHubItems?.[itemId];
  if (!item) {
    throw new Error("Dokumen persetujuan tidak ditemukan.");
  }
  if (actor.isActive === false) {
    throw new Error(
      "Akun Anda berstatus Nonaktif dan tidak dapat melakukan tindakan pengajuan atau persetujuan."
    );
  }
  const access = resolveUserApprovalAccess(draft, actor, synced.items);
  const isR = actor.id === item.responsibleUserId;
  const isA1 = !access.isAdmin && item.groupType === "program_documents" && actor.id === item.accountableProgramUserId && actor.permissions?.canApproveTor !== false;
  const isA2 = !access.isAdmin && item.groupType === "financial_documents" && actor.id === item.accountableFinanceUserId && actor.permissions?.canApproveTor !== false;
  const isDirector = !access.isAdmin && (actor.id === item.directorUserId || actor.role === "director");
  const isFinanceObserver = !access.isAdmin && actor.role === "finance" && item.groupType === "financial_documents";
  const isProgramDoc = item.groupType === "program_documents";
  const canViewItem = canUserViewApprovalItem(item, actor, access);
  if (!canViewItem && !(isR && (action === "comment" || action === "submit" || action === "create_new_version" || action === "request_edit") || isA1 && action === "request_edit")) {
    throw new Error(
      "Akses ditolak: Anda tidak memiliki hak akses untuk melihat atau memproses dokumen pengajuan ini."
    );
  }
  const trimmedComment = comment.trim();
  if (action === "revision" && !trimmedComment) {
    throw new Error("Pengembalian untuk revisi wajib disertai komentar perbaikan.");
  }
  if (action === "reject" && !trimmedComment) {
    throw new Error("Penolakan dokumen wajib disertai alasan penolakan.");
  }
  if (action === "comment" && !trimmedComment) {
    throw new Error("Komentar tidak boleh kosong.");
  }
  if (action === "request_edit" && !trimmedComment) {
    throw new Error("Alasan permintaan edit wajib diisi.");
  }
  let actorRoleCode = "C";
  if (isDirector && (action === "report_to_director" || action === "director_final_approve" || action === "approve_edit_request" || action === "reject_edit_request")) {
    actorRoleCode = "Direktur";
  } else if (isA1 && isProgramDoc) {
    actorRoleCode = "A1";
  } else if (isA2 && !isProgramDoc) {
    actorRoleCode = "A2";
  } else if (isR || action === "request_edit") {
    actorRoleCode = "R";
  } else if (isDirector) {
    actorRoleCode = "Direktur";
  } else if (actor.role === "admin") {
    actorRoleCode = "Admin";
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  let nextStatus = item.status;
  let actionLabel = "";
  let notifType = "ENTER_VERIFICATION";
  let notifMessage = "";
  let notifTargets = [];
  let notifRoles = [];
  const cleanItemTitle = (item.title || "").replace(
    /^(Cash Advance|Laporan Keuangan Akhir|Dokumentasi|Executive Summary|Notulen Rapat|Notulen|ToR):\s*/i,
    ""
  );
  if (action === "request_edit" || action === "approve_edit_request" || action === "reject_edit_request") {
    if (item.categoryCode !== "tor") {
      throw new Error("Fitur Request Edit Dokumen saat ini khusus untuk tiket Approval ToR.");
    }
    const torIdx = (draft.tors || []).findIndex((t) => t.id === item.sourceTorId);
    if (torIdx === -1) {
      throw new Error("Dokumen ToR sumber tidak ditemukan.");
    }
    const tor = draft.tors[torIdx];
    if (action === "request_edit") {
      if (actor.role === "admin" || !isR && !isA1) {
        throw new Error(
          `Hanya R (${item.responsibleUserName}) dan A1 (${item.accountableProgramUserName}) pada ToR ini yang berwenang mengajukan izin Request Edit kepada Direktur.`
        );
      }
      const requesterRaciLabel = isA1 ? "A1 \u2013 Accountable Program" : "R \u2013 Responsible";
      const requesterRaciShort = isA1 ? "A1" : "R";
      tor.editRequestStatus = "pending";
      tor.editRequestedById = actor.id;
      tor.editRequestedByName = actor.name;
      tor.editRequestedByRole = `${actor.roleTitle} (${requesterRaciShort})`;
      tor.editRequestedAt = nowIso;
      tor.editRequestReason = trimmedComment;
      tor.updatedAt = nowIso;
      item.previewData = {
        ...item.previewData,
        editRequestStatus: "pending",
        editRequestedById: actor.id,
        editRequestedByName: actor.name,
        editRequestedByRole: `${actor.roleTitle} (${requesterRaciShort})`,
        editRequestedAt: nowIso,
        editRequestReason: trimmedComment
      };
      item.currentStepNumber = 3;
      item.currentActiveRole = "Direktur";
      if (item.steps?.[2]) {
        item.steps[2] = {
          ...item.steps[2],
          status: "Sedang Berjalan",
          receivedAt: nowIso,
          notes: `Permintaan Akses Edit ToR dari ${actor.name} (${requesterRaciShort}): "${trimmedComment}"`
        };
      }
      item.updatedAt = nowIso;
      actionLabel = `Mengajukan Request Edit Dokumen ToR ke Direktur (${requesterRaciShort})`;
      item.timeline.unshift({
        id: `tl-${item.id}-${Date.now()}`,
        timestamp: nowIso,
        actorId: actor.id,
        actorName: actor.name,
        actorRoleCode: requesterRaciShort,
        actorRoleTitle: actor.roleTitle,
        responsibleName: item.responsibleUserName,
        actionLabel,
        resultingStatus: item.status,
        comment: `Permintaan akses edit ToR oleh ${requesterRaciLabel} kepada Direktur: "${trimmedComment}"`,
        version: item.version
      });
      if (!draft.approvalRecords) draft.approvalRecords = [];
      draft.approvalRecords.unshift({
        id: `app-${Date.now()}`,
        torId: tor.id,
        stage: "Akses Edit",
        action: "Request Edit",
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        comment: `Mengajukan izin edit (${requesterRaciShort}) kepada Direktur melalui Approval ToR: "${trimmedComment}"`,
        timestamp: nowIso,
        resultingStatus: tor.submissionStatus
      });
      if (!draft.approvalNotifications) draft.approvalNotifications = [];
      draft.approvalNotifications.unshift({
        id: `notif-edreq-${Date.now()}`,
        approvalItemId: item.id,
        referenceNumber: item.referenceNumber,
        documentTitle: item.title,
        categoryCode: "tor",
        categoryLabel: item.categoryLabel,
        eventType: "ENTER_VERIFICATION",
        message: `Request Edit ToR "${cleanItemTitle}" diajukan oleh ${actor.name} (${requesterRaciShort}) dan menunggu ACC Edit Direktur di Approval ToR. Alasan: "${trimmedComment}"`,
        targetUserIds: [item.directorUserId],
        targetRoleCodes: ["Direktur"],
        createdAt: nowIso,
        isReadByUserIds: []
      });
      draft.auditLogs.unshift({
        id: `log-apv-edreq-${Date.now()}`,
        actorId: actor.id,
        actorName: actor.name,
        actorRole: `${actor.roleTitle} (${requesterRaciShort})`,
        action: "Approval ToR: Request Edit ke Direktur",
        entityType: "TOR",
        entityId: tor.id,
        details: `[${item.referenceNumber}] ${actor.name} (${requesterRaciShort}) mengajukan Request Edit ToR ke Direktur: "${trimmedComment}"`,
        timestamp: nowIso
      });
      return {
        item,
        message: "Permintaan edit dokumen ToR berhasil masuk ke tiket Approval ToR dan menunggu keputusan (ACC Edit) Direktur."
      };
    }
    if (!isDirector) {
      throw new Error(
        `Hanya Direktur (${item.directorUserName}) yang berwenang menyetujui (ACC) atau menolak Request Edit ToR.`
      );
    }
    const isApproveEdit = action === "approve_edit_request";
    const effectiveNote = trimmedComment || (isApproveEdit ? "Permintaan akses edit dokumen ToR disetujui (ACC) oleh Direktur di Approval ToR." : "Permintaan akses edit dokumen ToR ditolak oleh Direktur di Approval ToR.");
    tor.editRequestStatus = isApproveEdit ? "approved" : "rejected";
    tor.editReviewedByName = actor.name;
    tor.editReviewedAt = nowIso;
    tor.editReviewComment = effectiveNote;
    tor.updatedAt = nowIso;
    item.previewData = {
      ...item.previewData,
      editRequestStatus: isApproveEdit ? "approved" : "rejected",
      editReviewedByName: actor.name,
      editReviewedAt: nowIso,
      editReviewComment: effectiveNote
    };
    item.isLocked = !isApproveEdit;
    item.currentStepNumber = 3;
    item.currentActiveRole = "Selesai";
    if (item.steps?.[2]) {
      item.steps[2] = {
        ...item.steps[2],
        status: "Selesai",
        actedAt: nowIso,
        notes: effectiveNote
      };
    }
    item.updatedAt = nowIso;
    actionLabel = isApproveEdit ? "Menyetujui (ACC) Request Edit Dokumen ToR (Direktur)" : "Menolak Request Edit Dokumen ToR (Direktur)";
    item.timeline.unshift({
      id: `tl-${item.id}-${Date.now()}`,
      timestamp: nowIso,
      actorId: actor.id,
      actorName: actor.name,
      actorRoleCode: "Direktur",
      actorRoleTitle: actor.roleTitle,
      responsibleName: item.responsibleUserName,
      actionLabel,
      resultingStatus: item.status,
      comment: effectiveNote,
      version: item.version
    });
    if (!draft.approvalRecords) draft.approvalRecords = [];
    draft.approvalRecords.unshift({
      id: `app-${Date.now()}`,
      torId: tor.id,
      stage: "Akses Edit",
      action: isApproveEdit ? "ACC Edit" : "Tolak Edit",
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      comment: effectiveNote,
      timestamp: nowIso,
      resultingStatus: tor.submissionStatus
    });
    const targetUsers = Array.from(
      new Set(
        [
          item.responsibleUserId,
          item.accountableProgramUserId,
          tor.editRequestedById || ""
        ].filter(Boolean)
      )
    );
    if (!draft.approvalNotifications) draft.approvalNotifications = [];
    draft.approvalNotifications.unshift({
      id: `notif-edrev-${Date.now()}`,
      approvalItemId: item.id,
      referenceNumber: item.referenceNumber,
      documentTitle: item.title,
      categoryCode: "tor",
      categoryLabel: item.categoryLabel,
      eventType: isApproveEdit ? "APPROVED" : "REJECTED",
      message: isApproveEdit ? `Request Edit ToR "${cleanItemTitle}" telah di-ACC oleh Direktur (${actor.name}). Dokumen ToR kini terbuka untuk diedit oleh R / A1.` : `Request Edit ToR "${cleanItemTitle}" ditolak oleh Direktur (${actor.name}): "${effectiveNote}"`,
      targetUserIds: targetUsers,
      targetRoleCodes: ["R", "A1"],
      createdAt: nowIso,
      isReadByUserIds: []
    });
    draft.auditLogs.unshift({
      id: `log-apv-edrev-${Date.now()}`,
      actorId: actor.id,
      actorName: actor.name,
      actorRole: `${actor.roleTitle} (Direktur)`,
      action: isApproveEdit ? "Approval ToR: ACC Request Edit ToR" : "Approval ToR: Tolak Request Edit ToR",
      entityType: "TOR",
      entityId: tor.id,
      details: `[${item.referenceNumber}] ${actionLabel} \u2014 Catatan: "${effectiveNote}"`,
      timestamp: nowIso
    });
    return {
      item,
      message: isApproveEdit ? `Request Edit untuk ${item.referenceNumber} berhasil di-ACC. Dokumen ToR kini terbuka untuk diedit.` : `Request Edit untuk ${item.referenceNumber} telah ditolak.`
    };
  }
  if (action === "comment") {
    if (!canViewItem && !isR) {
      throw new Error("Anda tidak memiliki akses untuk memberikan catatan pada dokumen ini.");
    }
    actionLabel = isFinanceObserver && !isA2 ? "Catatan Pencatatan & Pemantauan Finance" : isR ? "Balasan Diskusi / Catatan Pengaju (R)" : "Menambahkan Komentar / Masukan Pemeriksa";
    item.timeline.unshift({
      id: `tl-${item.id}-${Date.now()}`,
      timestamp: nowIso,
      actorId: actor.id,
      actorName: actor.name,
      actorRoleCode,
      actorRoleTitle: actor.roleTitle,
      responsibleName: item.responsibleUserName,
      actionLabel,
      resultingStatus: item.status,
      comment: trimmedComment,
      version: item.version
    });
    item.updatedAt = nowIso;
    if (!draft.approvalNotifications) draft.approvalNotifications = [];
    const commentTargets = isR ? [
      isProgramDoc ? item.accountableProgramUserId : item.accountableFinanceUserId,
      item.directorUserId
    ] : [item.responsibleUserId];
    const commentRoles = isR ? [isProgramDoc ? "A1" : "A2", "Direktur"] : ["R"];
    draft.approvalNotifications.unshift({
      id: `notif-cmt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      approvalItemId: item.id,
      referenceNumber: item.referenceNumber,
      documentTitle: cleanItemTitle,
      categoryCode: item.categoryCode,
      categoryLabel: item.categoryLabel,
      eventType: "ENTER_VERIFICATION",
      message: `${actor.name} (${actorRoleCode}) menulis pada "${cleanItemTitle}": "${trimmedComment}"`,
      targetUserIds: commentTargets,
      targetRoleCodes: commentRoles,
      createdAt: nowIso,
      isReadByUserIds: []
    });
    return { item, message: "Komentar diskusi berhasil ditambahkan dan disinkronkan ke tiket." };
  }
  if (action === "create_new_version") {
    if (!isR) {
      throw new Error(
        "Hanya R (Responsible) pada Activity terkait yang berwenang membuat versi revisi baru."
      );
    }
    if (item.status === "Pending Verification" || item.status === "Pending Approval") {
      throw new Error(
        `Pencegahan Double Submission: Dokumen ini sedang dalam proses pemeriksaan (${item.status}) dan tidak dapat diajukan ulang sebelum ada keputusan pemeriksa.`
      );
    }
    if ((item.status === "Approved" || item.status === "Reported to Director") && item.previewData?.editRequestStatus !== "approved") {
      throw new Error(
        "Dokumen yang telah disetujui bersifat terkunci (final). Ajukan Request Edit kepada Direktur terlebih dahulu jika memerlukan perubahan."
      );
    }
    item.version = (item.version || 1) + 1;
    item.isLocked = false;
    nextStatus = "Pending Verification";
    actionLabel = `Membuat Versi Baru (v${item.version}) & Mengajukan Ulang Persetujuan`;
    notifType = "NEW_SUBMISSION";
    notifMessage = `Versi baru v${item.version} untuk "${cleanItemTitle}" diajukan kembali oleh R (${actor.name}).`;
    notifTargets = [
      isProgramDoc ? item.accountableProgramUserId : item.accountableFinanceUserId
    ];
    notifRoles = [isProgramDoc ? "A1" : "A2"];
  } else if (action === "submit") {
    if (actor.role === "admin") {
      throw new Error(
        "Admin mengatur konfigurasi akses, tetapi tidak memiliki kewenangan pengajuan atau persetujuan."
      );
    }
    if (!isR) {
      throw new Error(
        `Hanya R (Responsible: ${item.responsibleUserName}) yang berwenang mengajukan atau memperbaiki dokumen ini.`
      );
    }
    if (item.status === "Pending Verification" || item.status === "Pending Approval") {
      throw new Error(
        `Pencegahan Double Submission: Dokumen "${item.referenceNumber}" sudah diajukan dan sedang menunggu pemeriksaan (${item.status}).`
      );
    }
    if ((item.status === "Approved" || item.status === "Reported to Director") && item.previewData?.editRequestStatus !== "approved") {
      throw new Error(
        "Dokumen ini telah disetujui dan terkunci. Tidak dapat diajukan ulang tanpa izin edit."
      );
    }
    const wasRevision = item.status === "Revision Required" || item.status === "Rejected";
    if (wasRevision) {
      item.version = (item.version || 1) + 1;
    }
    nextStatus = "Pending Verification";
    item.submittedAt = nowIso;
    item.isLocked = false;
    actionLabel = wasRevision ? `Mengajukan Ulang Dokumen Setelah Perbaikan (v${item.version}) oleh R` : "Mengajukan Dokumen untuk Diverifikasi (R)";
    notifType = "NEW_SUBMISSION";
    notifMessage = `"${cleanItemTitle}" diajukan oleh R (${actor.name}) dan menunggu pemeriksaan ${isProgramDoc ? `A1 (${item.accountableProgramUserName})` : `A2 (${item.accountableFinanceUserName})`}.`;
    notifTargets = [
      isProgramDoc ? item.accountableProgramUserId : item.accountableFinanceUserId
    ];
    notifRoles = [isProgramDoc ? "A1" : "A2"];
  } else if (action === "verify_approve") {
    if (actor.role === "admin") {
      throw new Error(
        "Admin dapat mengatur konfigurasi akses, tetapi tidak otomatis memiliki kewenangan persetujuan."
      );
    }
    if (isR) {
      throw new Error(
        "Integritas Persetujuan: Pengaju dokumen (R) tidak diperbolehkan menyetujui pengajuannya sendiri pada tahap pemeriksaan/verifikasi."
      );
    }
    if (item.status !== "Pending Verification" && item.status !== "Submitted") {
      if (item.status === "Approved" || item.status === "Pending Approval" || item.status === "Reported to Director") {
        throw new Error(
          `Pencegahan Double Approval: Dokumen "${item.referenceNumber}" sudah melewati tahap verifikasi ${isProgramDoc ? "A1" : "A2"} (Status saat ini: ${item.status}).`
        );
      }
      throw new Error(
        `Transisi Status Tidak Valid: Dokumen berstatus "${item.status}" belum dapat diverifikasi oleh ${isProgramDoc ? "A1" : "A2"}. Dokumen harus diajukan oleh R terlebih dahulu.`
      );
    }
    if (isProgramDoc) {
      if (!isA1) {
        throw new Error(
          `Dokumen program pada Output ini hanya dapat diperiksa dan disetujui oleh A1 \u2013 Accountable Program (${item.accountableProgramUserName}).`
        );
      }
      nextStatus = "Approved";
      item.isLocked = true;
      actionLabel = "Memeriksa & Menyetujui Dokumen Program (A1)";
      notifType = "APPROVED";
      notifMessage = `"${cleanItemTitle}" telah disetujui oleh A1 (${actor.name}) dan diteruskan kepada Direktur (${item.directorUserName}).`;
      notifTargets = [item.directorUserId, item.responsibleUserId];
      notifRoles = ["Direktur", "R"];
    } else {
      if (!isA2) {
        if (isFinanceObserver) {
          throw new Error(
            `Akun Finance Anda hanya memiliki akses pemantauan & pencatatan. Verifikasi hanya dapat dilakukan oleh A2 \u2013 Accountable Finance (${item.accountableFinanceUserName}).`
          );
        }
        throw new Error(
          `Dokumen keuangan hanya dapat diverifikasi oleh A2 \u2013 Accountable Finance (${item.accountableFinanceUserName}).`
        );
      }
      nextStatus = "Pending Approval";
      actionLabel = "Memverifikasi Dokumen Keuangan (A2)";
      notifType = "ENTER_VERIFICATION";
      notifMessage = `"${cleanItemTitle}" telah diverifikasi oleh A2 (${actor.name}) dan menunggu Persetujuan Akhir Direktur (${item.directorUserName}).`;
      notifTargets = [item.directorUserId, item.responsibleUserId];
      notifRoles = ["Direktur", "R"];
    }
  } else if (action === "report_to_director") {
    if (!isProgramDoc) {
      throw new Error("Tindakan pelaporan hanya berlaku untuk Dokumen Program.");
    }
    if (isR && !isDirector) {
      throw new Error(
        "Integritas Persetujuan: Pengaju dokumen (R) tidak diperbolehkan mengesahkan pelaporan dokumennya sendiri."
      );
    }
    if (!isA1 && !isDirector) {
      throw new Error(
        "Hanya A1 \u2013 Accountable Program atau Direktur yang berwenang memproses pelaporan dokumen program kepada Direktur."
      );
    }
    if (item.status === "Reported to Director") {
      throw new Error(
        `Pencegahan Double Approval: Dokumen "${item.referenceNumber}" sudah dilaporkan dan diterima oleh Direktur.`
      );
    }
    if (item.status !== "Approved" && item.status !== "Pending Approval") {
      throw new Error(
        `Dokumen tidak dapat melewati tahapan wajib: "${item.referenceNumber}" masih berstatus "${item.status}" dan wajib diperiksa serta disetujui oleh A1 (${item.accountableProgramUserName}) terlebih dahulu sebelum diteruskan ke Direktur.`
      );
    }
    nextStatus = "Reported to Director";
    item.isLocked = true;
    item.completedAt = nowIso;
    actionLabel = isDirector ? "Menerima & Mencatat Laporan Dokumen Program (Direktur)" : "Melaporkan Dokumen yang Telah Disetujui A1 kepada Direktur";
    notifType = "FINAL_COMPLETED";
    notifMessage = `"${cleanItemTitle}" telah resmi dilaporkan kepada Direktur (${item.directorUserName}).`;
    notifTargets = [item.directorUserId, item.responsibleUserId, item.accountableProgramUserId];
    notifRoles = ["Direktur", "R", "A1"];
  } else if (action === "director_final_approve") {
    if (!isDirector) {
      throw new Error(
        `Hanya Direktur (${item.directorUserName}) yang berwenang memberikan persetujuan akhir.`
      );
    }
    if (isR) {
      throw new Error(
        "Integritas Persetujuan: Pengaju dokumen (R) tidak diperbolehkan memberikan persetujuan akhir atas pengajuannya sendiri pada tahap yang sama."
      );
    }
    if (isProgramDoc) {
      if (item.status === "Reported to Director") {
        throw new Error(
          `Pencegahan Double Approval: Dokumen program "${item.referenceNumber}" sudah disahkan oleh Direktur.`
        );
      }
      if (item.status !== "Approved" && item.status !== "Pending Approval") {
        throw new Error(
          `Dokumen tidak dapat melewati tahapan wajib: Dokumen program "${item.referenceNumber}" wajib diperiksa dan disetujui oleh A1 (${item.accountableProgramUserName}) terlebih dahulu sebelum disahkan Direktur.`
        );
      }
    } else {
      if (item.status === "Approved") {
        throw new Error(
          `Pencegahan Double Approval: Dokumen keuangan "${item.referenceNumber}" sudah disetujui akhir oleh Direktur.`
        );
      }
      if (item.status !== "Pending Approval") {
        throw new Error(
          `Dokumen tidak dapat melewati tahapan wajib: Dokumen keuangan "${item.referenceNumber}" masih berstatus "${item.status}" dan wajib diverifikasi oleh A2 \u2013 Accountable Finance (${item.accountableFinanceUserName}) terlebih dahulu sebelum Persetujuan Akhir Direktur.`
        );
      }
    }
    nextStatus = isProgramDoc ? "Reported to Director" : "Approved";
    item.isLocked = true;
    item.completedAt = nowIso;
    actionLabel = isProgramDoc ? "Menerima & Mengesahkan Pelaporan Dokumen Program (Direktur)" : "Memberikan Persetujuan Akhir Dokumen Keuangan (Direktur)";
    notifType = "FINAL_COMPLETED";
    const allFinanceIds = (draft.users || []).filter(
      (u) => u.isActive !== false && (u.role === "finance" || (u.roleTitle || "").toLowerCase().includes("finance") || (u.roleTitle || "").toLowerCase().includes("kasir"))
    ).map((u) => u.id);
    if (item.categoryCode === "cash_advance") {
      notifMessage = `"${cleanItemTitle}" telah disetujui oleh Direktur (${actor.name}). Selanjutnya Finance akan mencairkan dana ke rekening pengaju (${item.responsibleUserName}).`;
      notifTargets = Array.from(
        new Set([item.responsibleUserId, item.accountableFinanceUserId, ...allFinanceIds].filter(Boolean))
      );
      notifRoles = ["R", "A2"];
    } else {
      notifMessage = `"${cleanItemTitle}" telah mendapatkan pengesahan akhir dari Direktur (${actor.name}).`;
      notifTargets = Array.from(
        new Set(
          [
            item.responsibleUserId,
            isProgramDoc ? item.accountableProgramUserId : item.accountableFinanceUserId
          ].filter(Boolean)
        )
      );
      notifRoles = ["R", isProgramDoc ? "A1" : "A2"];
    }
  } else if (action === "revision") {
    if (actor.role === "admin") {
      throw new Error(
        "Admin dapat mengatur konfigurasi akses, tetapi tidak otomatis memiliki kewenangan persetujuan/revisi."
      );
    }
    if (isR) {
      throw new Error("Pengaju (R) tidak dapat meminta revisi atas dokumennya sendiri.");
    }
    const canReturnForRevision = isProgramDoc && (isA1 || isDirector) || !isProgramDoc && (isA2 || isDirector);
    if (!canReturnForRevision) {
      throw new Error("Anda tidak memiliki kewenangan mengembalikan dokumen ini untuk revisi.");
    }
    if (item.status === "Draft" || item.status === "Revision Required" || item.status === "Rejected" || item.status === "Archived" || item.status === "Reported to Director" || !isProgramDoc && item.status === "Approved") {
      throw new Error(
        `Dokumen berstatus "${item.status}" tidak dapat dikembalikan untuk revisi pada tahap ini.`
      );
    }
    nextStatus = "Revision Required";
    item.isLocked = false;
    actionLabel = `Mengembalikan Dokumen untuk Revisi (${actorRoleCode})`;
    notifType = "REVISION_REQUIRED";
    notifMessage = `"${cleanItemTitle}" dikembalikan untuk revisi oleh ${actor.name} (${actorRoleCode}): "${trimmedComment}"`;
    notifTargets = [item.responsibleUserId];
    notifRoles = ["R"];
  } else if (action === "reject") {
    if (actor.role === "admin") {
      throw new Error(
        "Admin dapat mengatur konfigurasi akses, tetapi tidak otomatis memiliki kewenangan menolak pengajuan."
      );
    }
    if (isR) {
      throw new Error("Pengaju (R) tidak dapat menolak dokumennya sendiri.");
    }
    const canReject = isProgramDoc && (isA1 || isDirector) || !isProgramDoc && (isA2 || isDirector);
    if (!canReject) {
      throw new Error("Anda tidak memiliki kewenangan menolak dokumen ini.");
    }
    if (item.status === "Draft" || item.status === "Rejected" || item.status === "Archived" || item.status === "Reported to Director" || !isProgramDoc && item.status === "Approved") {
      throw new Error(
        `Dokumen berstatus "${item.status}" tidak dapat ditolak pada tahap ini.`
      );
    }
    nextStatus = "Rejected";
    item.isLocked = false;
    actionLabel = `Menolak Pengajuan Dokumen (${actorRoleCode})`;
    notifType = "REJECTED";
    notifMessage = `"${cleanItemTitle}" ditolak oleh ${actor.name} (${actorRoleCode}): "${trimmedComment}"`;
    notifTargets = [item.responsibleUserId];
    notifRoles = ["R"];
  } else if (action === "archive") {
    if (!isDirector && !isA1 && !isA2) {
      throw new Error("Anda tidak memiliki kewenangan mengarsipkan dokumen ini.");
    }
    nextStatus = "Archived";
    item.isArchived = true;
    item.isLocked = true;
    actionLabel = "Mengarsipkan Dokumen Persetujuan";
  }
  item.status = nextStatus;
  item.updatedAt = nowIso;
  const updatedStepInfo = buildStepsForStatus({
    categoryCode: item.categoryCode,
    status: nextStatus,
    responsibleUserId: item.responsibleUserId,
    responsibleUserName: item.responsibleUserName,
    accountableProgramUserId: item.accountableProgramUserId,
    accountableProgramUserName: item.accountableProgramUserName,
    accountableFinanceUserId: item.accountableFinanceUserId,
    accountableFinanceUserName: item.accountableFinanceUserName,
    directorUserId: item.directorUserId,
    directorUserName: item.directorUserName,
    submittedAt: item.submittedAt,
    verifiedAt: nowIso,
    verifiedNotes: action === "verify_approve" || action === "revision" || action === "reject" ? trimmedComment || actionLabel : item.steps?.[1]?.notes,
    completedAt: item.completedAt || nowIso,
    directorNotes: action === "report_to_director" || action === "director_final_approve" ? trimmedComment || actionLabel : item.steps?.[2]?.notes,
    refPrefix: item.sourceEntityId.toUpperCase()
  });
  item.steps = updatedStepInfo.steps;
  item.currentStepNumber = updatedStepInfo.currentStepNumber;
  item.currentActiveRole = updatedStepInfo.currentActiveRole;
  item.timeline.unshift({
    id: `tl-${item.id}-${Date.now()}`,
    timestamp: nowIso,
    actorId: actor.id,
    actorName: actor.name,
    actorRoleCode,
    actorRoleTitle: actor.roleTitle,
    responsibleName: item.responsibleUserName,
    actionLabel,
    resultingStatus: nextStatus,
    comment: trimmedComment || actionLabel,
    version: item.version
  });
  if (item.categoryCode === "tor") {
    const torIdx = (draft.tors || []).findIndex((t) => t.id === item.sourceTorId);
    if (torIdx !== -1) {
      if (nextStatus === "Draft") draft.tors[torIdx].submissionStatus = "Draft";
      else if (nextStatus === "Pending Verification") {
        draft.tors[torIdx].submissionStatus = "Menunggu Persetujuan Finance";
        draft.tors[torIdx].editRequestStatus = "none";
      } else if (nextStatus === "Approved")
        draft.tors[torIdx].submissionStatus = "Menunggu Persetujuan Director";
      else if (nextStatus === "Reported to Director") {
        draft.tors[torIdx].submissionStatus = "Disetujui";
        draft.tors[torIdx].isOfficialNumber = true;
        draft.tors[torIdx].publishedAt = nowIso;
        draft.tors[torIdx].editRequestStatus = "none";
      } else if (nextStatus === "Revision Required") {
        draft.tors[torIdx].submissionStatus = "Perlu Perbaikan";
        draft.tors[torIdx].editRequestStatus = "approved";
        draft.tors[torIdx].editReviewedByName = actor.name;
        draft.tors[torIdx].editReviewedAt = nowIso;
        draft.tors[torIdx].editReviewComment = trimmedComment || "Akses edit otomatis dibuka karena dokumen diminta revisi.";
      } else if (nextStatus === "Rejected") draft.tors[torIdx].submissionStatus = "Ditolak";
      else if (nextStatus === "Archived") draft.tors[torIdx].isArchivedCompleted = true;
      draft.tors[torIdx].updatedAt = nowIso;
      if (!draft.approvalRecords) draft.approvalRecords = [];
      draft.approvalRecords.unshift({
        id: `app-${Date.now()}`,
        torId: item.sourceTorId,
        stage: action === "revision" ? "Revisi" : actorRoleCode === "Direktur" ? "Director" : actorRoleCode === "A2" ? "Finance" : "Pengajuan",
        action: action === "revision" ? "Minta Perbaikan" : action === "reject" ? "Ditolak" : action === "submit" || action === "create_new_version" ? "Diajukan Ulang" : "Disetujui",
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        comment: trimmedComment || actionLabel,
        timestamp: nowIso,
        resultingStatus: draft.tors[torIdx].submissionStatus
      });
    }
  } else if (item.categoryCode === "cash_advance") {
    const caIdx = (draft.cashAdvances || []).findIndex(
      (c) => c.id === item.sourceCashAdvanceId
    );
    if (caIdx !== -1) {
      const ca = draft.cashAdvances[caIdx];
      if (nextStatus === "Pending Verification") {
        ca.status = "Diajukan";
      } else if (nextStatus === "Pending Approval") {
        ca.status = "Diverifikasi Finance";
        ca.signatures = {
          ...ca.signatures,
          verifiedBy: {
            name: actor.name,
            roleTitle: actor.roleTitle,
            date: nowIso.slice(0, 10),
            status: "Terverifikasi",
            notes: trimmedComment || "Diverifikasi oleh A2 di Pusat Persetujuan."
          }
        };
      } else if (nextStatus === "Approved") {
        ca.status = "Disetujui";
        ca.signatures = {
          ...ca.signatures,
          approvedBy: {
            name: actor.name,
            roleTitle: actor.roleTitle,
            date: nowIso.slice(0, 10),
            status: "Disetujui",
            notes: trimmedComment || "Disetujui Akhir oleh Direktur di Pusat Persetujuan."
          }
        };
      } else if (nextStatus === "Revision Required") {
        ca.status = "Perlu Perbaikan";
      } else if (nextStatus === "Rejected") {
        ca.status = "Ditolak";
      }
      ca.updatedAt = nowIso;
    }
  } else if (item.categoryCode === "laporan_keuangan_akhir") {
    const caIdx = (draft.cashAdvances || []).findIndex(
      (c) => c.id === item.sourceCashAdvanceId
    );
    if (caIdx !== -1) {
      const ca = draft.cashAdvances[caIdx];
      ca.isReported = true;
      if (nextStatus === "Pending Verification") {
        ca.reportApprovalStatus = "Menunggu Pemeriksaan Finance";
      } else if (nextStatus === "Pending Approval") {
        ca.reportApprovalStatus = "Menunggu Persetujuan Director";
        ca.reportVerifiedByName = actor.name;
        ca.reportVerifiedAt = nowIso;
        ca.reportVerifiedNotes = trimmedComment || "Diverifikasi oleh A2.";
      } else if (nextStatus === "Approved") {
        ca.reportApprovalStatus = "Telah Disetujui";
        ca.reportApprovedByName = actor.name;
        ca.reportApprovedAt = nowIso;
        ca.reportApprovedNotes = trimmedComment || "Disetujui akhir oleh Direktur.";
      } else if (nextStatus === "Revision Required") {
        ca.reportApprovalStatus = "Perlu Revisi";
      } else if (nextStatus === "Rejected") {
        ca.reportApprovalStatus = "Ditolak";
      }
      ca.updatedAt = nowIso;
    }
  } else if (item.categoryCode === "notulen") {
    const mmIdx = (draft.meetingMinutes || []).findIndex((m) => m.id === item.sourceEntityId);
    if (mmIdx !== -1) {
      draft.meetingMinutes[mmIdx].updatedAt = nowIso;
    }
  } else if (item.categoryCode === "dokumentasi") {
    const docIdx = (draft.activityDocumentationList || []).findIndex(
      (d) => d.id === item.sourceEntityId
    );
    if (docIdx !== -1) {
      draft.activityDocumentationList[docIdx].updatedAt = nowIso;
    }
  } else if (item.categoryCode === "executive_summary") {
    const monItem = draft.monitoringReports?.[item.sourceEntityId];
    if (monItem) {
      if (nextStatus === "Reported to Director" || nextStatus === "Approved") {
        monItem.status = "Completed";
      } else if (nextStatus === "Pending Verification" || nextStatus === "Revision Required") {
        monItem.status = "In Progress";
      }
      monItem.updatedAt = nowIso;
    }
  }
  if (notifMessage) {
    if (!draft.approvalNotifications) draft.approvalNotifications = [];
    draft.approvalNotifications = draft.approvalNotifications.filter(
      (n) => !(n.approvalItemId === item.id && (n.id === `notif-init-${item.id}` || n.eventType === notifType && n.message === notifMessage))
    );
    draft.approvalNotifications.unshift({
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      approvalItemId: item.id,
      referenceNumber: item.referenceNumber,
      documentTitle: item.title,
      categoryCode: item.categoryCode,
      categoryLabel: item.categoryLabel,
      eventType: notifType,
      message: notifMessage,
      targetUserIds: notifTargets,
      targetRoleCodes: notifRoles,
      createdAt: nowIso,
      isReadByUserIds: []
    });
  }
  draft.auditLogs.unshift({
    id: `log-apv-${Date.now()}`,
    actorId: actor.id,
    actorName: actor.name,
    actorRole: `${actor.roleTitle} (${actorRoleCode})`,
    action: `Approval Hub: ${actionLabel}`,
    entityType: item.categoryCode === "cash_advance" ? "CASH_ADVANCE" : item.categoryCode === "laporan_keuangan_akhir" ? "CASH_ADVANCE_SUMMARY" : "TOR",
    entityId: item.sourceTorId,
    details: `[${item.categoryLabel} \xB7 ${item.referenceNumber}] ${actionLabel} \u2014 Status: ${nextStatus}${trimmedComment ? ` | Catatan: "${trimmedComment}"` : ""}`,
    timestamp: nowIso
  });
  return {
    item,
    message: `Berhasil memproses "${actionLabel}" untuk dokumen ${item.referenceNumber}.`
  };
}

// src/server/attendanceService.ts
function normalizeValidClockIso(val) {
  if (typeof val !== "string") return void 0;
  const trimmed = val.trim();
  if (!trimmed || trimmed.startsWith("0000-00-00")) return void 0;
  return trimmed;
}
function isActiveAttendanceClockSession(record) {
  if (!record) return false;
  const hasClockIn = Boolean(normalizeValidClockIso(record.clockInTime));
  const hasClockOut = Boolean(normalizeValidClockIso(record.clockOutTime));
  return hasClockIn && !hasClockOut;
}
function findActiveClockSessionForUser(records, userId) {
  if (!Array.isArray(records) || !userId) return void 0;
  const activeMatches = records.filter(
    (r) => r && r.userId === userId && isActiveAttendanceClockSession(r)
  );
  if (activeMatches.length === 0) return void 0;
  if (activeMatches.length === 1) return activeMatches[0];
  return [...activeMatches].sort(
    (a, b) => String(b.clockInTime || "").localeCompare(String(a.clockInTime || ""))
  )[0];
}
function resolveAttendanceWorkflowType(userId, userRole, userRoleTitle) {
  const uid = String(userId || "").toLowerCase();
  const role = String(userRole || "").toLowerCase();
  const title = String(userRoleTitle || "").toLowerCase();
  if (uid === "user-director" || role === "director" || title.includes("director") || title.includes("direktur")) {
    return "DIRECTOR_TO_FINANCE_NOTIFY";
  }
  if (uid === "user-finance" || role === "finance" || role === "hr" || title.includes("finance") || title.includes("hr manager")) {
    return "FINANCE_TO_DIRECTOR_REVIEW";
  }
  return "EMPLOYEE_TO_FINANCE_APPROVAL";
}
function isAttendanceArrangementActiveOnCalendar(status, workflowType) {
  const s = String(status || "").trim();
  if (workflowType === "DIRECTOR_TO_FINANCE_NOTIFY") {
    return s === "Notified to Finance" || s === "Acknowledged by Finance" || s === "Approved";
  }
  if (workflowType === "FINANCE_TO_DIRECTOR_REVIEW") {
    return s === "Submitted for Review" || s === "Reviewed by Director" || s === "Approved" || s === "Disetujui HR" || s === "Disetujui Director";
  }
  return s === "Approved" || s === "Disetujui HR" || s === "Disetujui Director";
}
var DEFAULT_WIJNA_LOCATION_CONFIG = {
  officeName: "Kantor Pusat Yayasan WIJNA",
  address: "Kantor WIJNA (-7.342604, 110.489848)",
  latitude: -7.342604,
  longitude: 110.489848,
  radiusMeters: 5,
  standardDailyHours: 8,
  updatedByName: "Ratna Kusuma, S.E. (Finance & HR)",
  updatedAt: "2026-11-01T08:00:00Z"
};
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const toRad = (deg) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}
function calculateWorkHoursBetween(clockInIso, clockOutIso) {
  const start = new Date(clockInIso).getTime();
  const end = new Date(clockOutIso).getTime();
  if (isNaN(start) || isNaN(end) || end <= start) return 0;
  const diffHours = (end - start) / (1e3 * 60 * 60);
  return Math.round(diffHours * 100) / 100;
}
function enumerateDatesBetween(startDate, endDate, workingDaysOnly = false) {
  const startStr = String(startDate || "").slice(0, 10);
  const endStr = String(endDate || startStr).slice(0, 10);
  if (!startStr) return [];
  const s = /* @__PURE__ */ new Date(`${startStr}T00:00:00Z`);
  const e = /* @__PURE__ */ new Date(`${endStr}T00:00:00Z`);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) {
    return [startStr];
  }
  const allDates = [];
  const weekdayDates = [];
  const cur = new Date(s);
  let safety = 0;
  while (cur <= e && safety < 366) {
    const iso = cur.toISOString().slice(0, 10);
    allDates.push(iso);
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      weekdayDates.push(iso);
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
    safety++;
  }
  if (workingDaysOnly && weekdayDates.length > 0) {
    return weekdayDates;
  }
  return allDates;
}
function calculateWorkingDaysBetween(startDate, endDate) {
  const dates = enumerateDatesBetween(startDate, endDate, true);
  return Math.max(1, dates.length);
}
function createInitialAttendanceSystem() {
  const leavePolicies = [
    {
      id: "leave-pol-sick-1",
      code: "CS-RJ",
      name: "Cuti Sakit Rawat Jalan",
      group: "CUTI_SAKIT",
      allocationDaysPerYear: 12,
      requiresAttachmentOrNote: true,
      termsAndProvisions: "Maksimal 2 hari berturut-turut cukup dengan keterangan staf; >2 hari wajib melampirkan surat keterangan dokter.",
      isActive: true,
      updatedByName: "Ratna Kusuma, S.E. (Finance & HR)",
      updatedAt: "2026-01-10T08:00:00Z"
    },
    {
      id: "leave-pol-sick-2",
      code: "CS-RI",
      name: "Cuti Sakit Rawat Inap / Pemulihan Medis",
      group: "CUTI_SAKIT",
      allocationDaysPerYear: 30,
      requiresAttachmentOrNote: true,
      termsAndProvisions: "Berdasarkan surat rujukan rumah sakit/dokter dan diketahui oleh Finance/HR serta disetujui Director.",
      isActive: true,
      updatedByName: "Ratna Kusuma, S.E. (Finance & HR)",
      updatedAt: "2026-01-10T08:00:00Z"
    },
    {
      id: "leave-pol-spec-1",
      code: "CK-KLG",
      name: "Cuti Khusus Pernikahan / Kelahiran / Kedukaan",
      group: "CUTI_KHUSUS",
      allocationDaysPerYear: 5,
      requiresAttachmentOrNote: true,
      termsAndProvisions: "Cuti khusus di luar kuota cuti tahunan untuk pernikahan staf (3 hari), pendampingan persalinan (5 hari), atau kedukaan keluarga inti (3 hari).",
      isActive: true,
      updatedByName: "Ratna Kusuma, S.E. (Finance & HR)",
      updatedAt: "2026-01-10T08:00:00Z"
    },
    {
      id: "leave-pol-oth-1",
      code: "CT-REG",
      name: "Cuti Tahunan Reguler",
      group: "CUTI_LAINNYA",
      allocationDaysPerYear: 12,
      requiresAttachmentOrNote: false,
      termsAndProvisions: "Diajukan minimal H-3 sebelum tanggal cuti, direview oleh Finance/HR dan disetujui secara manual oleh Director.",
      isActive: true,
      updatedByName: "Ratna Kusuma, S.E. (Finance & HR)",
      updatedAt: "2026-01-10T08:00:00Z"
    },
    {
      id: "leave-pol-oth-2",
      code: "IZ-MDS",
      name: "Izin Keperluan Mendesak",
      group: "CUTI_LAINNYA",
      allocationDaysPerYear: 3,
      requiresAttachmentOrNote: true,
      termsAndProvisions: "Izin keperluan keluarga atau urusan mendesak dengan persetujuan Finance/HR & pengakuan Director.",
      isActive: true,
      updatedByName: "Ratna Kusuma, S.E. (Finance & HR)",
      updatedAt: "2026-01-10T08:00:00Z"
    }
  ];
  return {
    locationConfig: { ...DEFAULT_WIJNA_LOCATION_CONFIG },
    records: [],
    flextimeAssignments: [],
    leavePolicies,
    leaveRequests: [],
    wfaRequests: [],
    holidayRequests: [],
    employeeTrainings: [],
    employeeProfileLinks: {},
    workRecapVerifications: {},
    auditTrail: []
  };
}
function ensureAttendanceSystemInitialized(draft) {
  if (!draft.attendanceSystem || typeof draft.attendanceSystem !== "object") {
    draft.attendanceSystem = createInitialAttendanceSystem();
  } else {
    const seed = createInitialAttendanceSystem();
    if (!draft.attendanceSystem.locationConfig) {
      draft.attendanceSystem.locationConfig = seed.locationConfig;
    }
    if (!Array.isArray(draft.attendanceSystem.records)) {
      draft.attendanceSystem.records = [];
    } else {
      for (const rec of draft.attendanceSystem.records) {
        if (!rec || typeof rec !== "object") continue;
        if (rec.clockOutTime !== void 0 && !normalizeValidClockIso(rec.clockOutTime)) {
          delete rec.clockOutTime;
        }
      }
    }
    if (!Array.isArray(draft.attendanceSystem.flextimeAssignments)) {
      draft.attendanceSystem.flextimeAssignments = [];
    }
    if (!Array.isArray(draft.attendanceSystem.leavePolicies) || draft.attendanceSystem.leavePolicies.length === 0) {
      draft.attendanceSystem.leavePolicies = seed.leavePolicies;
    }
    if (!Array.isArray(draft.attendanceSystem.leaveRequests)) {
      draft.attendanceSystem.leaveRequests = [];
    }
    if (!Array.isArray(draft.attendanceSystem.wfaRequests)) {
      draft.attendanceSystem.wfaRequests = [];
    }
    if (!Array.isArray(draft.attendanceSystem.holidayRequests)) {
      draft.attendanceSystem.holidayRequests = [];
    }
    if (!Array.isArray(draft.attendanceSystem.employeeTrainings)) {
      draft.attendanceSystem.employeeTrainings = [];
    }
    if (!draft.attendanceSystem.employeeProfileLinks || typeof draft.attendanceSystem.employeeProfileLinks !== "object") {
      draft.attendanceSystem.employeeProfileLinks = {};
    }
    if (!draft.attendanceSystem.workRecapVerifications || typeof draft.attendanceSystem.workRecapVerifications !== "object") {
      draft.attendanceSystem.workRecapVerifications = {};
    }
    if (!Array.isArray(draft.attendanceSystem.auditTrail)) {
      draft.attendanceSystem.auditTrail = [];
    }
  }
  return draft.attendanceSystem;
}

// src/lib/hierarchyExcelParser.ts
import * as XLSX from "xlsx";
var sanitizeCell = (val) => {
  const str = String(val ?? "").trim();
  return str.replace(/^[=+\-@\t\r]+/, "").trim();
};
var normalizeDateStr = (val, fallback) => {
  if (!val) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const d = new Date(val);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return fallback;
};
var getCanonicalOcKey = (num, desc, fallbackName) => {
  const cleanNum = (num || (fallbackName.match(/^(Outcome\s*[\d.]+)/i)?.[1] ?? "")).replace(/\s+/g, " ").trim().toLowerCase();
  if (cleanNum) return cleanNum;
  return (fallbackName || desc).trim().toLowerCase();
};
var getCanonicalOpKey = (num, desc, fallbackName) => {
  const cleanNum = (num || (fallbackName.match(/^(Output\s*[\d.]+)/i)?.[1] ?? "")).replace(/\s+/g, " ").trim().toLowerCase();
  if (cleanNum) return cleanNum;
  return (fallbackName || desc).trim().toLowerCase();
};
var getCanonicalActKey = (num, actName) => {
  const cleanNum = (num || (actName.match(/^(Activity\s*[\d.]+)/i)?.[1] ?? "")).replace(/\s+/g, " ").trim().toLowerCase();
  const cleanTitle = actName.replace(/^Activity\s*[\d.]+\s*[:\-–]?\s*/i, "").trim().toLowerCase();
  if (cleanNum && cleanTitle) return `${cleanNum}__${cleanTitle}`;
  return cleanNum || cleanTitle || actName.trim().toLowerCase();
};
var HEADER_KEYWORD_REGEX = /^(nomor\s*outcome|no\.?\s*outcome|outcome\s*number|outcome\s*no|kode\s*outcome|outcome|nama\s*outcome|outcome\s*name|nomor\s*output|no\.?\s*output|output\s*number|output\s*no|kode\s*output|output|nama\s*output|output\s*name|activity|nama\s*activity|nama\s*kegiatan|activity\s*name|nomor\s*activity)$/i;
function extractNormalizedRowsFromSheet(sheet) {
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: true
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
      const clean = String(rawCell ?? "").replace(/\s+/g, " ").trim();
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
  const parentGroupRow = bestHeaderIdx > 0 && Array.isArray(matrix[bestHeaderIdx - 1]) ? matrix[bestHeaderIdx - 1] : [];
  let passedOutputAnchor = false;
  let passedActivityAnchor = false;
  let activeGroupBanner = "";
  const normalizedHeaders = rawHeaderCells.map((cellVal, colIdx) => {
    const groupCell = String(parentGroupRow[colIdx] ?? "").replace(/\s+/g, " ").trim();
    if (groupCell) {
      activeGroupBanner = groupCell.toLowerCase();
    }
    const baseHeader = String(cellVal ?? "").replace(/\s+/g, " ").trim();
    if (!baseHeader) return `__EMPTY_${colIdx}`;
    if (/^(nomor\s*output|no\.?\s*output|output\s*number|output\s*no|kode\s*output|output|nama\s*output|output\s*name)$/i.test(baseHeader)) {
      passedOutputAnchor = true;
    }
    if (/^(activity|nama\s*activity|nama\s*kegiatan|activity\s*name|nomor\s*activity)$/i.test(baseHeader)) {
      passedActivityAnchor = true;
    }
    const inOutputSection = !passedActivityAnchor && (passedOutputAnchor || /\boutput\b/i.test(activeGroupBanner));
    if (inOutputSection && !/\boutput\b/i.test(baseHeader)) {
      if (/^(description|deskripsi)$/i.test(baseHeader)) return "Description Output";
      if (/^(progress\s*indicator|indikator)$/i.test(baseHeader)) return "Progress indicator Output";
      if (/^(data\s*source|sumber\s*data)$/i.test(baseHeader)) return "Data source Output";
      if (/^(cumulative\s*or\s*non-?cumulative|sifat\s*indikator)$/i.test(baseHeader)) {
        return "Cumulative or non-cumulative Output";
      }
      if (/^(planned\s*data\s*breakdown|data\s*breakdown|disagregasi\s*data)$/i.test(baseHeader)) {
        return "Planned data breakdown Output";
      }
      if (/^(reporting\s*frequency|frekuensi\s*pelaporan)$/i.test(baseHeader)) {
        return "Reporting frequency Output";
      }
      if (/^baseline$/i.test(baseHeader)) return "Baseline Output";
      if (/^(end\s*of\s*project\s*goal|target)$/i.test(baseHeader)) {
        return "End of project goal Output";
      }
      if (/^(satuan|unit)$/i.test(baseHeader)) return "Unit Output";
    }
    return baseHeader;
  });
  const usedHeaderNames = /* @__PURE__ */ new Map();
  const uniqueHeaders = normalizedHeaders.map((h) => {
    const count = usedHeaderNames.get(h) || 0;
    usedHeaderNames.set(h, count + 1);
    return count === 0 ? h : `${h}_${count}`;
  });
  const rows = [];
  for (let rIdx = bestHeaderIdx + 1; rIdx < matrix.length && rows.length < 500; rIdx++) {
    const rowArr = Array.isArray(matrix[rIdx]) ? matrix[rIdx] : [];
    const record = {};
    let hasNonEmptyCell = false;
    for (let cIdx = 0; cIdx < uniqueHeaders.length; cIdx++) {
      const val = sanitizeCell(rowArr[cIdx]);
      if (val) hasNonEmptyCell = true;
      record[uniqueHeaders[cIdx]] = val;
    }
    if (hasNonEmptyCell) {
      rows.push({
        excelRowNumber: rIdx + 1,
        record
      });
    }
  }
  return {
    headerRowNumber: bestHeaderIdx + 1,
    headerMatched,
    detectedHeaders: uniqueHeaders.filter((h) => !h.startsWith("__EMPTY")),
    rows
  };
}
function parseProgramHierarchyWorkbookBuffer(params) {
  const {
    buffer,
    program,
    existingOutcomes,
    existingOutputs,
    existingActivities,
    existingSubActivities
  } = params;
  const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (uint8.byteLength === 0) {
    throw new Error("File Excel kosong (0 byte).");
  }
  let workbook;
  try {
    workbook = XLSX.read(uint8, { type: "array" });
  } catch (err) {
    throw new Error(`Format workbook Excel rusak atau tidak dapat dibaca: ${err?.message || "Unreadable workbook"}`);
  }
  if (!workbook || !Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
    return {
      sheetName: "",
      sheetCount: 0,
      rawRowCount: 0,
      headerMatched: false,
      detectedHeaders: [],
      rows: []
    };
  }
  const prioritizedSheetNames = [
    ...workbook.SheetNames.filter(
      (n) => /hirarki|hierarki|matriks|logframe|matrix|program|sheet1/i.test(n) && !/rumus|panduan|guide|instruksi/i.test(n)
    ),
    ...workbook.SheetNames.filter(
      (n) => !(/hirarki|hierarki|matriks|logframe|matrix|program|sheet1/i.test(n) && !/rumus|panduan|guide|instruksi/i.test(n))
    )
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
      rows: []
    };
  }
  const progOutcomes = existingOutcomes.filter((o) => o.programId === program.id);
  const defaultStart = program.startDate || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const defaultEnd = program.endDate || defaultStart;
  const findCol = (row, pattern) => {
    const key = Object.keys(row).find((k) => pattern.test(k.trim()));
    return key ? sanitizeCell(row[key]) : "";
  };
  const outcomeOrder = progOutcomes.map(
    (o) => getCanonicalOcKey(o.outcomeNumber || "", o.description || "", o.name)
  );
  const outputOrderByOutcome = /* @__PURE__ */ new Map();
  const actCountByOutput = /* @__PURE__ */ new Map();
  progOutcomes.forEach((oc) => {
    const ocKey = getCanonicalOcKey(oc.outcomeNumber || "", oc.description || oc.name, oc.name);
    const ops = existingOutputs.filter((op) => op.outcomeId === oc.id);
    outputOrderByOutcome.set(
      ocKey,
      ops.map((op) => getCanonicalOpKey(op.outputNumber || "", op.description || "", op.name))
    );
    ops.forEach((op) => {
      const opNorm = getCanonicalOpKey(op.outputNumber || "", op.description || "", op.name);
      const opFullKey = `${ocKey}__${opNorm}`;
      const acts = existingActivities.filter((a) => a.outputId === op.id);
      actCountByOutput.set(opFullKey, acts.length);
    });
  });
  const existingOutcomeSet = /* @__PURE__ */ new Set();
  const existingOutcomeIndicatorSet = /* @__PURE__ */ new Set();
  const existingOutputSet = /* @__PURE__ */ new Set();
  const existingOutputIndicatorSet = /* @__PURE__ */ new Set();
  const existingActivitySet = /* @__PURE__ */ new Set();
  const existingSubSet = /* @__PURE__ */ new Set();
  progOutcomes.forEach((oc) => {
    const ocKey = getCanonicalOcKey(oc.outcomeNumber || "", oc.description || "", oc.name);
    existingOutcomeSet.add(ocKey);
    existingOutcomeSet.add(oc.name.trim().toLowerCase());
    if (oc.outcomeNumber) {
      existingOutcomeSet.add(oc.outcomeNumber.trim().toLowerCase());
    }
    (oc.indicators || []).forEach((ind) => {
      existingOutcomeIndicatorSet.add(`${ocKey}__${ind.name.trim().toLowerCase()}`);
    });
    existingOutputs.filter((op) => op.outcomeId === oc.id).forEach((op) => {
      const opNorm = getCanonicalOpKey(op.outputNumber || "", op.description || "", op.name);
      const opKey = `${ocKey}__${opNorm}`;
      existingOutputSet.add(opKey);
      existingOutputSet.add(`${ocKey}__${op.name.trim().toLowerCase()}`);
      (op.indicators || []).forEach((ind) => {
        existingOutputIndicatorSet.add(`${opKey}__${ind.name.trim().toLowerCase()}`);
      });
      existingActivities.filter((a) => a.outputId === op.id).forEach((act) => {
        const actNorm = getCanonicalActKey(act.activityNumber || "", act.name);
        const actKey = `${opKey}__${actNorm}`;
        existingActivitySet.add(actKey);
        existingActivitySet.add(`${opKey}__${act.name.trim().toLowerCase()}`);
        existingSubActivities.filter((s) => s.activityId === act.id).forEach((sub) => {
          existingSubSet.add(`${actKey}__${sub.name.trim().toLowerCase()}`);
        });
      });
    });
  });
  const seenOutcomesInFile = /* @__PURE__ */ new Set();
  const seenOutcomeIndicatorsInFile = /* @__PURE__ */ new Set();
  const seenOutputsInFile = /* @__PURE__ */ new Set();
  const seenOutputIndicatorsInFile = /* @__PURE__ */ new Set();
  const seenActivitiesInFile = /* @__PURE__ */ new Set();
  const seenSubsInFile = /* @__PURE__ */ new Set();
  let lastOutcomeNumber = "";
  let lastOutcomeName = "";
  let lastOutcomeDesc = "";
  let lastOutputNumber = "";
  let lastOutputName = "";
  let lastOutputDesc = "";
  let lastActivityNumber = "";
  let lastActivityName = "";
  let lastActivityCode = "";
  let lastActivityDesc = "";
  let lastActivityAnticipatedInputs = "";
  let lastActivityPlannedParticipants = "";
  let lastActivityStart = defaultStart;
  let lastActivityEnd = defaultEnd;
  const previewRows = [];
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
    if (!rawOcNum && !rawOcLegacyName && !rawOcDesc && !rawOcInd && !rawOpNum && !rawOpLegacyName && !rawOpDesc && !rawOpInd && !rawActName && !rawSubName) {
      return;
    }
    let currentOcNum = rawOcNum;
    let currentOcDesc = rawOcDesc;
    if (!currentOcNum && rawOcLegacyName) {
      const m = rawOcLegacyName.match(/^(Outcome\s*[\d.]+)\s*[:\-–]?\s*(.+)$/i);
      if (m) {
        currentOcNum = m[1].replace(/\s+/g, " ").trim();
        if (!currentOcDesc) currentOcDesc = m[2].trim();
      }
    }
    const hasExplicitOutcomeInRow = Boolean(currentOcNum || currentOcDesc || rawOcLegacyName);
    const hasExplicitOutputInRow = Boolean(rawOpNum || rawOpDesc || rawOpLegacyName);
    if (hasExplicitOutcomeInRow) {
      const nextNum = currentOcNum || lastOutcomeNumber;
      const nextDesc = currentOcDesc || rawOcLegacyName || lastOutcomeDesc;
      const nextCombined = nextNum && nextDesc && !nextDesc.toLowerCase().startsWith(nextNum.toLowerCase()) ? `${nextNum}: ${nextDesc}` : nextDesc || nextNum;
      if (!hasExplicitOutputInRow || lastOutcomeName && nextCombined.toLowerCase() !== lastOutcomeName.toLowerCase() && (currentOcNum.toLowerCase() !== lastOutcomeNumber.toLowerCase() || !currentOcNum)) {
        lastOutputNumber = "";
        lastOutputName = "";
        lastOutputDesc = "";
        lastActivityNumber = "";
        lastActivityName = "";
        lastActivityCode = "";
      }
      if (currentOcNum) lastOutcomeNumber = currentOcNum;
      if (currentOcDesc) lastOutcomeDesc = currentOcDesc;
      else if (rawOcLegacyName && !lastOutcomeDesc) lastOutcomeDesc = rawOcLegacyName;
      lastOutcomeName = nextCombined;
    }
    const outcomeNumber = lastOutcomeNumber || (lastOutcomeName ? "Outcome 1" : "");
    const outcomeDescription = lastOutcomeDesc || lastOutcomeName;
    const outcomeName = lastOutcomeName || (outcomeNumber && outcomeDescription ? `${outcomeNumber}: ${outcomeDescription}` : outcomeDescription);
    let currentOpNum2 = rawOpNum;
    let currentOpDesc2 = rawOpDesc;
    if (!currentOpNum2 && rawOpLegacyName) {
      const m = rawOpLegacyName.match(/^(Output\s*[\d.]+)\s*[:\-–]?\s*(.+)$/i);
      if (m) {
        currentOpNum2 = m[1].replace(/\s+/g, " ").trim();
        if (!currentOpDesc2) currentOpDesc2 = m[2].trim();
      }
    }
    if (currentOpNum2 || currentOpDesc2 || rawOpLegacyName) {
      const nextOpNum = currentOpNum2 || lastOutputNumber;
      const nextOpDesc = currentOpDesc2 || rawOpLegacyName || lastOutputDesc;
      const nextOpCombined = nextOpNum && nextOpDesc && !nextOpDesc.toLowerCase().startsWith(nextOpNum.toLowerCase()) ? `${nextOpNum}: ${nextOpDesc}` : nextOpDesc || nextOpNum;
      if (!rawActName || lastOutputName && nextOpCombined.toLowerCase() !== lastOutputName.toLowerCase() && (currentOpNum2.toLowerCase() !== lastOutputNumber.toLowerCase() || !currentOpNum2)) {
        lastActivityNumber = "";
        lastActivityName = "";
        lastActivityCode = "";
      }
      if (currentOpNum2) lastOutputNumber = currentOpNum2;
      if (currentOpDesc2) lastOutputDesc = currentOpDesc2;
      else if (rawOpLegacyName && !lastOutputDesc) lastOutputDesc = rawOpLegacyName;
      lastOutputName = nextOpCombined;
    }
    const hasOutputInRow = Boolean(
      currentOpNum2 || currentOpDesc2 || rawOpLegacyName || rawOpInd || rawActName || rawSubName
    );
    const outputNumber = hasOutputInRow ? lastOutputNumber : "";
    const outputDescription = hasOutputInRow ? lastOutputDesc || lastOutputName : "";
    const outputName = hasOutputInRow ? lastOutputName : "";
    if (rawActName) {
      const actMatch = rawActName.match(/^(Activity\s*[\d.]+)\s*[:\-–]?\s*(.+)$/i);
      const bareNumMatch = !actMatch ? rawActName.match(/^(\d+(?:\.\d+)+)\s*[:\-–.)]?\s+(.+)$/) : null;
      const extractedActNum = rawActNum || (actMatch ? actMatch[1].replace(/\s+/g, " ").trim() : bareNumMatch ? `Activity ${bareNumMatch[1]}` : "");
      const cleanActTitle = actMatch ? actMatch[2].trim() : bareNumMatch ? bareNumMatch[2].trim() : rawActName.trim();
      const formattedActName = actMatch ? `${extractedActNum}: ${cleanActTitle}` : rawActName.trim();
      lastActivityNumber = extractedActNum;
      lastActivityName = formattedActName;
      lastActivityCode = rawActCode || (bareNumMatch ? bareNumMatch[1] : "");
      lastActivityDesc = rawActDesc;
      lastActivityAnticipatedInputs = rawActInputs;
      lastActivityPlannedParticipants = rawActParticipants;
      lastActivityStart = normalizeDateStr(rawActStart, defaultStart);
      lastActivityEnd = normalizeDateStr(rawActEnd, defaultEnd);
    }
    const activityNumber = rawActName ? lastActivityNumber : rawSubName ? lastActivityNumber : "";
    const activityName = rawActName ? lastActivityName : rawSubName ? lastActivityName : "";
    const activityDescription = rawActDesc || (rawActName ? "" : lastActivityDesc);
    const activityAnticipatedInputs = rawActInputs || (rawActName ? "" : lastActivityAnticipatedInputs);
    const activityPlannedParticipants = rawActParticipants || (rawActName ? "" : lastActivityPlannedParticipants);
    const activityStartDate = rawActName ? normalizeDateStr(rawActStart, defaultStart) : lastActivityStart;
    const activityEndDate = rawActName ? normalizeDateStr(rawActEnd, defaultEnd) : lastActivityEnd;
    if (!outcomeName) {
      previewRows.push({
        rowNumber: excelRowNumber,
        outcomeNumber: "",
        outcomeName: "-",
        outcomeDescription: "",
        outcomeIndicator: rawOcInd,
        outcomeDataSource: rawOcDataSource,
        outcomeCumulative: rawOcCumulative,
        outcomePlannedBreakdown: rawOcPlannedBreakdown,
        outcomeReportingFrequency: rawOcReportingFreq,
        outcomeBaseline: rawOcBase,
        outcomeTarget: rawOcTarget,
        outcomeUnit: rawOcUnit,
        outputNumber: outputNumber || "",
        outputName: outputName || "-",
        outputDescription: outputDescription || "",
        outputIndicator: rawOpInd,
        outputDataSource: rawOpDataSource,
        outputCumulative: rawOpCumulative,
        outputPlannedBreakdown: rawOpPlannedBreakdown,
        outputReportingFrequency: rawOpReportingFreq,
        outputBaseline: rawOpBase,
        outputTarget: rawOpTarget,
        outputUnit: rawOpUnit,
        activityNumber: activityNumber || "",
        activityCode: rawActCode || "-",
        activityName: activityName || "-",
        activityDescription: "",
        activityAnticipatedInputs: activityAnticipatedInputs || "",
        activityPlannedParticipants: activityPlannedParticipants || "",
        activityStartDate,
        activityEndDate,
        subActivityName: rawSubName,
        subActivityPic: rawSubPic,
        status: "invalid",
        statusMessage: "Kolom Outcome wajib diisi",
        isNewOutcome: false,
        isNewOutcomeIndicator: false,
        isNewOutput: false,
        isNewOutputIndicator: false,
        isNewActivity: false,
        isNewSubActivity: false
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
        outputNumber: "",
        outputName: "-",
        outputDescription: "",
        outputIndicator: "",
        outputDataSource: "",
        outputCumulative: "",
        outputPlannedBreakdown: "",
        outputReportingFrequency: "",
        outputBaseline: "",
        outputTarget: "",
        outputUnit: "",
        activityNumber: activityNumber || "",
        activityCode: rawActCode || "-",
        activityName,
        activityDescription,
        activityAnticipatedInputs,
        activityPlannedParticipants,
        activityStartDate,
        activityEndDate,
        subActivityName: rawSubName,
        subActivityPic: rawSubPic,
        status: "invalid",
        statusMessage: "Activity memerlukan kolom Output induk",
        isNewOutcome: false,
        isNewOutcomeIndicator: false,
        isNewOutput: false,
        isNewOutputIndicator: false,
        isNewActivity: false,
        isNewSubActivity: false
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
        outputNumber: outputNumber || "",
        outputName: outputName || "-",
        outputDescription: outputDescription || "",
        outputIndicator: rawOpInd,
        outputDataSource: rawOpDataSource,
        outputCumulative: rawOpCumulative,
        outputPlannedBreakdown: rawOpPlannedBreakdown,
        outputReportingFrequency: rawOpReportingFreq,
        outputBaseline: rawOpBase,
        outputTarget: rawOpTarget,
        outputUnit: rawOpUnit,
        activityNumber: "",
        activityCode: "-",
        activityName: "-",
        activityDescription: "",
        activityAnticipatedInputs: "",
        activityPlannedParticipants: "",
        activityStartDate,
        activityEndDate,
        subActivityName: rawSubName,
        subActivityPic: rawSubPic,
        status: "invalid",
        statusMessage: "Sub-Activity memerlukan kolom Activity induk",
        isNewOutcome: false,
        isNewOutcomeIndicator: false,
        isNewOutput: false,
        isNewOutputIndicator: false,
        isNewActivity: false,
        isNewSubActivity: false
      });
      return;
    }
    const ocKey = getCanonicalOcKey(outcomeNumber, outcomeDescription, outcomeName);
    if (!outcomeOrder.includes(ocKey)) {
      outcomeOrder.push(ocKey);
    }
    const ocNum = outcomeOrder.indexOf(ocKey) + 1;
    let opNum = 1;
    const opNorm = outputName ? getCanonicalOpKey(outputNumber, outputDescription, outputName) : "";
    const opKey = opNorm ? `${ocKey}__${opNorm}` : "";
    if (opNorm) {
      const opList = outputOrderByOutcome.get(ocKey) || [];
      if (!opList.includes(opNorm)) {
        opList.push(opNorm);
        outputOrderByOutcome.set(ocKey, opList);
      }
      opNum = opList.indexOf(opNorm) + 1;
    }
    const ocIndKey = rawOcInd ? `${ocKey}__${rawOcInd.toLowerCase()}` : "";
    const opIndKey = rawOpInd && opKey ? `${opKey}__${rawOpInd.toLowerCase()}` : "";
    const actNorm = activityName ? getCanonicalActKey(activityNumber, activityName) : "";
    const actKey = actNorm && opKey ? `${opKey}__${actNorm}` : "";
    const subKey = rawSubName && actKey ? `${actKey}__${rawSubName.toLowerCase()}` : "";
    const isNewOutcome = !existingOutcomeSet.has(ocKey) && !existingOutcomeSet.has(outcomeName.toLowerCase()) && !seenOutcomesInFile.has(ocKey);
    const isNewOutcomeIndicator = Boolean(
      rawOcInd && !existingOutcomeIndicatorSet.has(ocIndKey) && !seenOutcomeIndicatorsInFile.has(ocIndKey)
    );
    const isNewOutput = Boolean(
      outputName && !existingOutputSet.has(opKey) && !seenOutputsInFile.has(opKey)
    );
    const isNewOutputIndicator = Boolean(
      rawOpInd && opKey && !existingOutputIndicatorSet.has(opIndKey) && !seenOutputIndicatorsInFile.has(opIndKey)
    );
    const isNewActivity = Boolean(
      activityName && !existingActivitySet.has(actKey) && !existingActivitySet.has(`${opKey}__${activityName.trim().toLowerCase()}`) && !seenActivitiesInFile.has(actKey)
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
    const nothingNewInRow = !isNewOutcome && !isNewOutcomeIndicator && !isNewOutput && !isNewOutputIndicator && !isNewActivity && !isNewSubActivity;
    const addedParts = [];
    if (isNewOutcome) addedParts.push(outcomeNumber || `Outcome ${ocNum}`);
    if (isNewOutcomeIndicator) addedParts.push("Indikator Outcome");
    if (isNewOutput) addedParts.push(outputNumber || `Output ${ocNum}.${opNum}`);
    if (isNewOutputIndicator) addedParts.push("Indikator Output");
    if (isNewActivity) addedParts.push(activityNumber || `Activity ${ocNum}.${opNum}`);
    if (isNewSubActivity) addedParts.push("Sub-Activity");
    previewRows.push({
      rowNumber: excelRowNumber,
      outcomeNumber: outcomeNumber || `Outcome ${ocNum}`,
      outcomeName,
      outcomeDescription,
      outcomeIndicator: rawOcInd,
      outcomeDataSource: rawOcDataSource,
      outcomeCumulative: rawOcCumulative || "Non cumulative",
      outcomePlannedBreakdown: rawOcPlannedBreakdown,
      outcomeReportingFrequency: rawOcReportingFreq || "Annual",
      outcomeBaseline: rawOcBase,
      outcomeTarget: rawOcTarget,
      outcomeUnit: rawOcUnit,
      outputNumber: outputNumber || (outputName ? `Output ${ocNum}.${opNum}` : ""),
      outputName,
      outputDescription,
      outputIndicator: rawOpInd,
      outputDataSource: rawOpDataSource,
      outputCumulative: rawOpCumulative || "Non cumulative",
      outputPlannedBreakdown: rawOpPlannedBreakdown,
      outputReportingFrequency: rawOpReportingFreq || "Annual",
      outputBaseline: rawOpBase,
      outputTarget: rawOpTarget,
      outputUnit: rawOpUnit,
      activityNumber: activityNumber || (activityName ? `Activity ${resolvedActCode || `${ocNum}.${opNum}`}` : ""),
      activityCode: resolvedActCode,
      activityName,
      activityDescription,
      activityAnticipatedInputs,
      activityPlannedParticipants,
      activityStartDate,
      activityEndDate,
      subActivityName: rawSubName,
      subActivityPic: rawSubPic,
      status: nothingNewInRow ? "duplicate" : "valid",
      statusMessage: nothingNewInRow ? "Sudah terdaftar di Hirarki Program (Dilewati)" : `Siap Diimpor: ${addedParts.join(" \u2192 ")}`,
      isNewOutcome,
      isNewOutcomeIndicator,
      isNewOutput,
      isNewOutputIndicator,
      isNewActivity,
      isNewSubActivity
    });
  });
  return {
    sheetName: chosenSheetName,
    sheetCount: workbook.SheetNames.length,
    rawRowCount: extracted.rows.length,
    headerMatched: extracted.headerMatched,
    detectedHeaders: extracted.detectedHeaders,
    rows: previewRows
  };
}
function buildHierarchyImportPlan(params) {
  const {
    validRows,
    program,
    existingOutcomes,
    existingOutputs,
    existingActivities,
    existingSubActivities
  } = params;
  const nowIso = params.nowIso || (/* @__PURE__ */ new Date()).toISOString();
  let seqCounter = 0;
  const makeId = (prefix) => {
    seqCounter += 1;
    return `${prefix}-${Date.now()}-${seqCounter}-${Math.random().toString(36).slice(2, 6)}`;
  };
  const outcomeById = /* @__PURE__ */ new Map();
  const outcomeIdByKey = /* @__PURE__ */ new Map();
  const touchedOutcomeIds = /* @__PURE__ */ new Set();
  const outputById = /* @__PURE__ */ new Map();
  const outputIdByKey = /* @__PURE__ */ new Map();
  const touchedOutputIds = /* @__PURE__ */ new Set();
  const activityById = /* @__PURE__ */ new Map();
  const activityIdByKey = /* @__PURE__ */ new Map();
  const touchedActivityIds = /* @__PURE__ */ new Set();
  const subActivityById = /* @__PURE__ */ new Map();
  const subActivityIdByKey = /* @__PURE__ */ new Map();
  const touchedSubActivityIds = /* @__PURE__ */ new Set();
  const expandedOutcomeIds = /* @__PURE__ */ new Set();
  const expandedOutputIds = /* @__PURE__ */ new Set();
  const progOutcomes = existingOutcomes.filter((o) => o.programId === program.id);
  progOutcomes.forEach((oc) => {
    const clonedOc = {
      ...oc,
      programId: program.id,
      indicators: Array.isArray(oc.indicators) ? [...oc.indicators] : []
    };
    outcomeById.set(clonedOc.id, clonedOc);
    const ocKey = getCanonicalOcKey(
      clonedOc.outcomeNumber || "",
      clonedOc.description || "",
      clonedOc.name
    );
    outcomeIdByKey.set(ocKey, clonedOc.id);
    outcomeIdByKey.set(clonedOc.name.trim().toLowerCase(), clonedOc.id);
    if (clonedOc.outcomeNumber) {
      outcomeIdByKey.set(clonedOc.outcomeNumber.trim().toLowerCase(), clonedOc.id);
    }
    existingOutputs.filter((op) => op.outcomeId === clonedOc.id).forEach((op) => {
      const clonedOp = {
        ...op,
        programId: program.id,
        outcomeId: clonedOc.id,
        indicators: Array.isArray(op.indicators) ? [...op.indicators] : []
      };
      outputById.set(clonedOp.id, clonedOp);
      const opNorm = getCanonicalOpKey(
        clonedOp.outputNumber || "",
        clonedOp.description || "",
        clonedOp.name
      );
      const opKey = `${ocKey}__${opNorm}`;
      outputIdByKey.set(opKey, clonedOp.id);
      outputIdByKey.set(`${ocKey}__${clonedOp.name.trim().toLowerCase()}`, clonedOp.id);
      if (clonedOp.outputNumber) {
        outputIdByKey.set(`${ocKey}__${clonedOp.outputNumber.trim().toLowerCase()}`, clonedOp.id);
      }
      existingActivities.filter((a) => a.outputId === clonedOp.id).forEach((act) => {
        const clonedAct = {
          ...act,
          programId: program.id,
          outcomeId: clonedOc.id,
          outputId: clonedOp.id
        };
        activityById.set(clonedAct.id, clonedAct);
        const actNorm = getCanonicalActKey(clonedAct.activityNumber || "", clonedAct.name);
        const actKey = `${opKey}__${actNorm}`;
        activityIdByKey.set(actKey, clonedAct.id);
        activityIdByKey.set(`${opKey}__${clonedAct.name.trim().toLowerCase()}`, clonedAct.id);
        existingSubActivities.filter((s) => s.activityId === clonedAct.id).forEach((sub) => {
          const clonedSub = {
            ...sub,
            activityId: clonedAct.id
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
    let outcomeId = outcomeIdByKey.get(ocKey) || outcomeIdByKey.get(row.outcomeName.trim().toLowerCase()) || (row.outcomeNumber ? outcomeIdByKey.get(row.outcomeNumber.trim().toLowerCase()) : void 0);
    const buildOcInd = () => {
      if (!row.outcomeIndicator || !row.outcomeIndicator.trim()) return null;
      return {
        id: makeId("ind-oc"),
        name: row.outcomeIndicator.trim(),
        description: "",
        dataSource: row.outcomeDataSource || "Laporan MEAL",
        cumulativeType: row.outcomeCumulative || "Non cumulative",
        plannedDataBreakdown: row.outcomePlannedBreakdown || "",
        reportingFrequency: row.outcomeReportingFrequency || "Annual",
        baseline: row.outcomeBaseline || "TBA",
        target: row.outcomeTarget || "",
        endOfProjectGoal: row.outcomeTarget || "",
        unit: row.outcomeUnit || "",
        verificationMethod: row.outcomeDataSource || "Laporan MEAL"
      };
    };
    if (!outcomeId) {
      outcomeAutoIdx += 1;
      outcomeId = makeId("outc");
      const ocNumber = row.outcomeNumber || `Outcome ${outcomeAutoIdx}`;
      const indicators = [];
      const firstInd = buildOcInd();
      if (firstInd) {
        indicators.push(firstInd);
        addedOutcomeIndicatorsCount += 1;
      }
      const newOc = {
        id: outcomeId,
        programId: program.id,
        outcomeNumber: ocNumber,
        code: ocNumber,
        name: row.outcomeName.trim(),
        projectName: program.name,
        description: row.outcomeDescription || row.outcomeName.trim(),
        indicators,
        status: "Belum Dimulai",
        createdAt: nowIso,
        updatedAt: nowIso
      };
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
      const existingOc = outcomeById.get(outcomeId);
      const nextInd = buildOcInd();
      if (nextInd) {
        const alreadyHas = existingOc.indicators.some(
          (i) => i.name.trim().toLowerCase() === nextInd.name.toLowerCase()
        );
        if (!alreadyHas) {
          existingOc.indicators = [...existingOc.indicators, nextInd];
          existingOc.updatedAt = nowIso;
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
      let outputId = outputIdByKey.get(opKey) || outputIdByKey.get(`${ocKey}__${row.outputName.trim().toLowerCase()}`) || (row.outputNumber ? outputIdByKey.get(`${ocKey}__${row.outputNumber.trim().toLowerCase()}`) : void 0);
      const buildOpInd = () => {
        if (!row.outputIndicator || !row.outputIndicator.trim()) return null;
        return {
          id: makeId("ind-op"),
          name: row.outputIndicator.trim(),
          description: "",
          dataSource: row.outputDataSource || "Activity report",
          cumulativeType: row.outputCumulative || "Non cumulative",
          plannedDataBreakdown: row.outputPlannedBreakdown || "",
          reportingFrequency: row.outputReportingFrequency || "Annual",
          baseline: row.outputBaseline || "TBA",
          target: row.outputTarget || "",
          endOfProjectGoal: row.outputTarget || "",
          unit: row.outputUnit || "",
          verificationMethod: row.outputDataSource || "Activity report"
        };
      };
      if (!outputId) {
        outputId = makeId("outp");
        const siblingCount = Array.from(outputById.values()).filter(
          (o) => o.outcomeId === outcomeId
        ).length;
        const parentOc = outcomeById.get(outcomeId);
        const ocDigits = parentOc?.outcomeNumber?.match(/\d+/)?.[0] || String(outcomeAutoIdx || 1);
        const opNumber = row.outputNumber || `Output ${ocDigits}.${siblingCount + 1}`;
        const indicators = [];
        const firstOpInd = buildOpInd();
        if (firstOpInd) {
          indicators.push(firstOpInd);
          addedOutputIndicatorsCount += 1;
        }
        const newOp = {
          id: outputId,
          programId: program.id,
          outcomeId,
          outputNumber: opNumber,
          code: opNumber,
          name: row.outputName.trim(),
          description: row.outputDescription || row.outputName.trim(),
          indicators,
          status: "Belum Dimulai",
          createdAt: nowIso,
          updatedAt: nowIso
        };
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
        const existingOp = outputById.get(outputId);
        const nextOpInd = buildOpInd();
        if (nextOpInd) {
          const alreadyHas = existingOp.indicators.some(
            (i) => i.name.trim().toLowerCase() === nextOpInd.name.toLowerCase()
          );
          if (!alreadyHas) {
            existingOp.indicators = [...existingOp.indicators, nextOpInd];
            existingOp.updatedAt = nowIso;
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
        let activityId = activityIdByKey.get(actKey) || activityIdByKey.get(`${opKey}__${row.activityName.trim().toLowerCase()}`);
        if (!activityId) {
          activityId = makeId("act");
          const siblingActCount = Array.from(activityById.values()).filter(
            (a) => a.outputId === outputId
          ).length;
          const parentOp = outputById.get(outputId);
          const opDigits = parentOp?.outputNumber?.match(/[\d.]+/)?.[0] || "1.1";
          const resolvedCode = row.activityCode && row.activityCode !== "-" ? row.activityCode : `${opDigits}.${siblingActCount + 1}`;
          const resolvedActNum = row.activityNumber || `Activity ${resolvedCode}`;
          const newAct = {
            id: activityId,
            programId: program.id,
            outcomeId,
            outputId,
            activityNumber: resolvedActNum,
            code: resolvedCode,
            name: row.activityName.trim(),
            description: row.activityDescription || "",
            anticipatedInputs: row.activityAnticipatedInputs || "",
            plannedParticipantsBreakdown: row.activityPlannedParticipants || "",
            startDate: row.activityStartDate || program.startDate || nowIso.slice(0, 10),
            endDate: row.activityEndDate || program.endDate || nowIso.slice(0, 10),
            status: "Belum Dimulai",
            createdAt: nowIso,
            updatedAt: nowIso
          };
          activityById.set(activityId, newAct);
          activityIdByKey.set(actKey, activityId);
          activityIdByKey.set(`${opKey}__${row.activityName.trim().toLowerCase()}`, activityId);
          touchedActivityIds.add(activityId);
          createdActivitiesCount += 1;
        } else if (row.activityDescription || row.activityAnticipatedInputs || row.activityPlannedParticipants) {
          const existingAct = activityById.get(activityId);
          let changed = false;
          if (row.activityDescription && row.activityDescription !== existingAct.description) {
            existingAct.description = row.activityDescription;
            changed = true;
          }
          if (row.activityAnticipatedInputs && row.activityAnticipatedInputs !== existingAct.anticipatedInputs) {
            existingAct.anticipatedInputs = row.activityAnticipatedInputs;
            changed = true;
          }
          if (row.activityPlannedParticipants && row.activityPlannedParticipants !== existingAct.plannedParticipantsBreakdown) {
            existingAct.plannedParticipantsBreakdown = row.activityPlannedParticipants;
            changed = true;
          }
          if (changed) {
            existingAct.updatedAt = nowIso;
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
            const subId = makeId("sub");
            const siblingSubCount = Array.from(subActivityById.values()).filter(
              (s) => s.activityId === activityId
            ).length;
            const parentAct = activityById.get(activityId);
            const leadingSubCode = row.subActivityName.trim().match(/^(\d+(?:\.\d+)+)\b/)?.[1];
            const resolvedSubCode = leadingSubCode || `${parentAct?.code || "1.1.1"}.${siblingSubCount + 1}`;
            const newSub = {
              id: subId,
              programId: program.id,
              outcomeId,
              outputId,
              activityId,
              code: resolvedSubCode,
              name: row.subActivityName.trim(),
              description: "",
              picName: row.subActivityPic || "",
              status: "Belum Dimulai",
              createdAt: nowIso,
              updatedAt: nowIso
            };
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
    outcomesToUpsert: Array.from(touchedOutcomeIds).map((id) => outcomeById.get(id)),
    outputsToUpsert: Array.from(touchedOutputIds).map((id) => outputById.get(id)),
    activitiesToUpsert: Array.from(touchedActivityIds).map((id) => activityById.get(id)),
    subActivitiesToUpsert: Array.from(touchedSubActivityIds).map((id) => subActivityById.get(id)),
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
    expandedOutputIds: Array.from(expandedOutputIds)
  };
}

// server.ts
var __filename = fileURLToPath2(import.meta.url);
var __dirname = path3.dirname(__filename);
var MAX_HIERARCHY_EXCEL_BYTES = 5 * 1024 * 1024;
async function extractExcelUploadFromRequest(req) {
  const contentType = String(req.headers["content-type"] || "");
  if (contentType.toLowerCase().includes("application/json")) {
    const rawName = String(req.body?.fileName || "").trim();
    const rawB64 = String(req.body?.fileBase64 || "").trim();
    if (!rawName || !rawB64) {
      throw Object.assign(new Error("Missing fileName or fileBase64 in JSON upload."), {
        httpStatus: 400,
        errorCategory: "UPLOAD_ERROR",
        userMessage: "[UPLOAD ERROR] File Excel belum dipilih atau gagal dikirim ke server."
      });
    }
    const cleanB64 = rawB64.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(cleanB64, "base64");
    if (buffer.byteLength === 0) {
      throw Object.assign(new Error("Uploaded Excel file is 0 bytes."), {
        httpStatus: 400,
        errorCategory: "UPLOAD_ERROR",
        userMessage: "[UPLOAD ERROR] File Excel kosong (0 byte)."
      });
    }
    if (buffer.byteLength > MAX_HIERARCHY_EXCEL_BYTES) {
      throw Object.assign(new Error("Uploaded Excel file exceeds 5 MB limit."), {
        httpStatus: 400,
        errorCategory: "UPLOAD_ERROR",
        userMessage: "[UPLOAD ERROR] Ukuran file Excel melebihi batas maksimum (5 MB)."
      });
    }
    return { fileName: rawName, buffer };
  }
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;,\s]+))/i);
  if (!contentType.toLowerCase().includes("multipart/form-data") || !boundaryMatch) {
    throw Object.assign(new Error(`Unsupported upload Content-Type: ${contentType}`), {
      httpStatus: 400,
      errorCategory: "UPLOAD_ERROR",
      userMessage: "[UPLOAD ERROR] Format pengiriman file tidak valid. Silakan pilih ulang file Excel (.xlsx, .xls, atau .csv)."
    });
  }
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const maxStreamBytes = MAX_HIERARCHY_EXCEL_BYTES + 256 * 1024;
  const rawBody = await new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += buf.length;
      if (received > maxStreamBytes) {
        settled = true;
        reject(
          Object.assign(new Error("Multipart upload exceeded 5 MB limit."), {
            httpStatus: 400,
            errorCategory: "UPLOAD_ERROR",
            userMessage: "[UPLOAD ERROR] Ukuran file Excel melebihi batas maksimum (5 MB)."
          })
        );
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on("error", (streamErr) => {
      if (settled) return;
      settled = true;
      reject(
        Object.assign(streamErr, {
          httpStatus: 400,
          errorCategory: "UPLOAD_ERROR",
          userMessage: "[UPLOAD ERROR] Koneksi terputus saat mengunggah file Excel ke server."
        })
      );
    });
  });
  const delimiter = Buffer.from(`--${boundary}`, "latin1");
  const headerEndMarker = Buffer.from("\r\n\r\n", "latin1");
  let searchPos = 0;
  while (searchPos < rawBody.length) {
    const partStart = rawBody.indexOf(delimiter, searchPos);
    if (partStart === -1) break;
    const afterDelimiter = partStart + delimiter.length;
    if (rawBody[afterDelimiter] === 45 && rawBody[afterDelimiter + 1] === 45) {
      break;
    }
    const headerStart = rawBody[afterDelimiter] === 13 && rawBody[afterDelimiter + 1] === 10 ? afterDelimiter + 2 : afterDelimiter;
    const headerEnd = rawBody.indexOf(headerEndMarker, headerStart);
    if (headerEnd === -1) break;
    const rawHeaders = rawBody.subarray(headerStart, headerEnd).toString("utf8");
    const contentStart = headerEnd + headerEndMarker.length;
    const nextPartBoundary = rawBody.indexOf(delimiter, contentStart);
    if (nextPartBoundary === -1) break;
    let contentEnd = nextPartBoundary;
    if (contentEnd >= 2 && rawBody[contentEnd - 2] === 13 && rawBody[contentEnd - 1] === 10) {
      contentEnd -= 2;
    }
    const filenameMatch = rawHeaders.match(/filename="([^"]*)"/i);
    if (filenameMatch) {
      const fileName = filenameMatch[1].trim();
      const fileSlice = Buffer.from(rawBody.subarray(contentStart, contentEnd));
      if (!fileName) {
        throw Object.assign(new Error("Empty filename in multipart upload."), {
          httpStatus: 400,
          errorCategory: "UPLOAD_ERROR",
          userMessage: "[UPLOAD ERROR] Nama file Excel tidak ditemukan pada unggahan."
        });
      }
      if (fileSlice.byteLength === 0) {
        throw Object.assign(new Error("Uploaded Excel file buffer is 0 bytes."), {
          httpStatus: 400,
          errorCategory: "UPLOAD_ERROR",
          userMessage: "[UPLOAD ERROR] File Excel kosong (0 byte)."
        });
      }
      if (fileSlice.byteLength > MAX_HIERARCHY_EXCEL_BYTES) {
        throw Object.assign(new Error("Uploaded Excel file exceeds 5 MB limit."), {
          httpStatus: 400,
          errorCategory: "UPLOAD_ERROR",
          userMessage: "[UPLOAD ERROR] Ukuran file Excel melebihi batas maksimum (5 MB)."
        });
      }
      return { fileName, buffer: fileSlice };
    }
    searchPos = nextPartBoundary;
  }
  throw Object.assign(new Error("No file field found in multipart/form-data payload."), {
    httpStatus: 400,
    errorCategory: "UPLOAD_ERROR",
    userMessage: "[UPLOAD ERROR] File Excel tidak ditemukan pada form unggahan."
  });
}
function getNextTorSequenceForYear(data, targetYear) {
  let maxSeq = 0;
  for (const t of data.tors || []) {
    let torYear = targetYear;
    if (t.publishedAt) {
      const d = new Date(t.publishedAt);
      if (!isNaN(d.getTime())) torYear = d.getFullYear();
    } else if (t.torNumber) {
      const yrMatch = t.torNumber.match(/\/(\d{4})$/);
      if (yrMatch) {
        torYear = parseInt(yrMatch[1], 10);
      } else if (t.createdAt) {
        const d = new Date(t.createdAt);
        if (!isNaN(d.getTime())) torYear = d.getFullYear();
      }
    }
    if (torYear === targetYear) {
      if (typeof t.torSequence === "number" && t.torSequence > maxSeq) {
        maxSeq = t.torSequence;
      }
      if (t.torNumber) {
        const match = t.torNumber.match(/^(?:TOR\/)?(\d{3})\/WIJNA\//);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxSeq) {
            maxSeq = num;
          }
        }
      }
    }
  }
  return maxSeq + 1;
}
async function startServer() {
  await db.ready();
  const app = express();
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    const origRegister = app[method].bind(app);
    app[method] = (routePath, ...handlers) => {
      const wrappedHandlers = handlers.map((fn) => {
        if (typeof fn !== "function" || fn.length > 3) return fn;
        return (req, res, next) => {
          try {
            const ret = fn(req, res, next);
            if (ret && typeof ret.catch === "function") {
              ret.catch(next);
            }
          } catch (syncErr) {
            next(syncErr);
          }
        };
      });
      return origRegister(routePath, ...wrappedHandlers);
    };
  }
  app.set("trust proxy", 1);
  const PORT = Number(process.env.PORT) || 3e3;
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const rawUrl = decodeURIComponent((req.originalUrl || req.url || "").split("?")[0] || "");
    const normalizedPath = rawUrl.replace(/\\/g, "/");
    if (normalizedPath.includes("..") || /^\/(?:\.env|\.git|data\/|database\/|scripts\/|server\.ts$|server\.js$|package\.json$|package-lock\.json$|bun\.lock$|tsconfig\.json$)/i.test(
      normalizedPath
    )) {
      return res.status(404).end();
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-XSS-Protection", "0");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    res.setHeader("Permissions-Policy", "geolocation=*, camera=(), microphone=(), payment=()");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https:; font-src 'self' https://fonts.gstatic.com data: https:; img-src 'self' data: blob: https:; connect-src 'self' ws: wss: https:; object-src 'none'; base-uri 'self'; frame-ancestors 'self' https://*.google.com https://*.aistudio.google.com https://*.usercontent.goog https://*.run.app;"
    );
    if (req.path.startsWith("/api")) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, private");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
    next();
  });
  app.use(express.json({ limit: "2mb" }));
  const DANGEROUS_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
  function sanitizeStringValue(val, keyName = "") {
    let cleaned = val.replace(/\0/g, "").replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "").replace(/<\/?(?:iframe|object|embed|applet|meta)\b[^>]*>/gi, "").replace(/(<[^>]+?)\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "$1");
    const trimmedLower = cleaned.trim().toLowerCase();
    if (trimmedLower.startsWith("javascript:") || trimmedLower.startsWith("vbscript:") || trimmedLower.startsWith("data:text/html")) {
      return "";
    }
    if (/(url|link|href)/i.test(keyName) && cleaned.trim()) {
      const candidate = cleaned.trim();
      if (!/^(https?:\/\/|\/|mailto:)/i.test(candidate)) {
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) {
          return "";
        }
      }
    }
    return cleaned;
  }
  function sanitizePayloadDeep(input, keyName = "", depth = 0) {
    if (depth > 12 || input === null || input === void 0) return input;
    if (typeof input === "string") {
      return sanitizeStringValue(input, keyName);
    }
    if (Array.isArray(input)) {
      return input.map((item) => sanitizePayloadDeep(item, keyName, depth + 1));
    }
    if (typeof input === "object") {
      const out = {};
      for (const [k, v] of Object.entries(input)) {
        if (DANGEROUS_KEYS.has(k)) continue;
        out[k] = sanitizePayloadDeep(v, k, depth + 1);
      }
      return out;
    }
    return input;
  }
  const DEFAULT_TESTING_PASSWORD = process.env.DEFAULT_TESTING_PASSWORD || "Wijna@2026";
  function resolvePersistentSessionSecret() {
    const envSecret = String(process.env.SESSION_SECRET || "").trim();
    if (envSecret.length >= 16 && envSecret !== "replace_with_random_64_char_hex_secret") {
      return envSecret;
    }
    const secretFilePath = path3.join(__dirname, "data", ".session_secret");
    try {
      if (fs3.existsSync(secretFilePath)) {
        const stored = fs3.readFileSync(secretFilePath, "utf-8").trim();
        if (stored.length >= 32) {
          return stored;
        }
      }
      const generated = crypto.randomBytes(32).toString("hex");
      const dataDir = path3.dirname(secretFilePath);
      if (!fs3.existsSync(dataDir)) {
        fs3.mkdirSync(dataDir, { recursive: true });
      }
      fs3.writeFileSync(secretFilePath, generated, { encoding: "utf-8", mode: 384 });
      return generated;
    } catch {
      return crypto.randomBytes(32).toString("hex");
    }
  }
  const SESSION_HMAC_SECRET = resolvePersistentSessionSecret();
  const SESSION_TTL_MS = 12 * 60 * 60 * 1e3;
  const SESSION_REFRESH_WINDOW_MS = 4 * 60 * 60 * 1e3;
  const activeSessions = /* @__PURE__ */ new Map();
  const revokedTokens = /* @__PURE__ */ new Map();
  const loginRateLimits = /* @__PURE__ */ new Map();
  const apiRateLimits = /* @__PURE__ */ new Map();
  function hashPassword(plainPassword) {
    const salt = crypto.randomBytes(16).toString("hex");
    const derived = crypto.scryptSync(plainPassword, salt, 64).toString("hex");
    return `scrypt$${salt}$${derived}`;
  }
  function safeHexEqual(hexA, hexB) {
    try {
      const bufA = Buffer.from(hexA, "hex");
      const bufB = Buffer.from(hexB, "hex");
      if (bufA.length === 0 || bufA.length !== bufB.length) return false;
      return crypto.timingSafeEqual(bufA, bufB);
    } catch {
      return false;
    }
  }
  function verifyPasswordWithMigration(plainPassword, storedHash) {
    if (!storedHash || typeof storedHash !== "string") {
      return { valid: false, needsRehash: false };
    }
    const trimmedHash = storedHash.trim();
    if (!trimmedHash) {
      return { valid: false, needsRehash: false };
    }
    if (trimmedHash.startsWith("scrypt$") || trimmedHash.startsWith("scrypt:")) {
      const sep = trimmedHash.startsWith("scrypt$") ? "$" : ":";
      const parts = trimmedHash.split(sep);
      if (parts.length !== 3) return { valid: false, needsRehash: false };
      const [, salt, originalHex] = parts;
      try {
        const derivedHex = crypto.scryptSync(plainPassword, salt, 64).toString("hex");
        const valid = safeHexEqual(derivedHex, originalHex);
        return { valid, needsRehash: valid && sep === ":" };
      } catch {
        return { valid: false, needsRehash: false };
      }
    }
    if (trimmedHash.startsWith("pbkdf2$")) {
      const parts = trimmedHash.split("$");
      if (parts.length === 4) {
        const [, iterStr, salt, originalHex] = parts;
        const iterations = parseInt(iterStr, 10) || 1e4;
        try {
          const keyLen = Math.floor(originalHex.length / 2) || 64;
          const derivedHex = crypto.pbkdf2Sync(plainPassword, salt, iterations, keyLen, "sha512").toString("hex");
          const valid = safeHexEqual(derivedHex, originalHex);
          return { valid, needsRehash: valid };
        } catch {
          return { valid: false, needsRehash: false };
        }
      }
    }
    if (trimmedHash.startsWith("sha256$")) {
      const parts = trimmedHash.split("$");
      if (parts.length === 3) {
        const [, salt, originalHex] = parts;
        const digestHex = crypto.createHash("sha256").update(`${salt}${plainPassword}`).digest("hex");
        const digestHexAlt = crypto.createHash("sha256").update(`${plainPassword}${salt}`).digest("hex");
        const valid = safeHexEqual(digestHex, originalHex) || safeHexEqual(digestHexAlt, originalHex);
        return { valid, needsRehash: valid };
      }
    }
    if (trimmedHash.startsWith("sha512$")) {
      const parts = trimmedHash.split("$");
      if (parts.length === 3) {
        const [, salt, originalHex] = parts;
        const digestHex = crypto.createHash("sha512").update(`${salt}${plainPassword}`).digest("hex");
        const digestHexAlt = crypto.createHash("sha512").update(`${plainPassword}${salt}`).digest("hex");
        const valid = safeHexEqual(digestHex, originalHex) || safeHexEqual(digestHexAlt, originalHex);
        return { valid, needsRehash: valid };
      }
    }
    if (/^[a-fA-F0-9]{64}$/.test(trimmedHash)) {
      const sha256Hex = crypto.createHash("sha256").update(plainPassword).digest("hex");
      const valid = safeHexEqual(sha256Hex, trimmedHash.toLowerCase());
      return { valid, needsRehash: valid };
    }
    if (/^[a-fA-F0-9]{128}$/.test(trimmedHash)) {
      const sha512Hex = crypto.createHash("sha512").update(plainPassword).digest("hex");
      const valid = safeHexEqual(sha512Hex, trimmedHash.toLowerCase());
      return { valid, needsRehash: valid };
    }
    if (/^[a-fA-F0-9]{32}$/.test(trimmedHash)) {
      const md5Hex = crypto.createHash("md5").update(plainPassword).digest("hex");
      const valid = safeHexEqual(md5Hex, trimmedHash.toLowerCase());
      return { valid, needsRehash: valid };
    }
    if (!trimmedHash.startsWith("$2") && !trimmedHash.startsWith("$argon2") && !trimmedHash.includes("$")) {
      const plainBuf = Buffer.from(plainPassword, "utf-8");
      const storedBuf = Buffer.from(trimmedHash, "utf-8");
      if (plainBuf.length === storedBuf.length && crypto.timingSafeEqual(plainBuf, storedBuf)) {
        return { valid: true, needsRehash: true };
      }
    }
    return { valid: false, needsRehash: false };
  }
  function verifyPassword(plainPassword, storedHash) {
    return verifyPasswordWithMigration(plainPassword, storedHash).valid;
  }
  const DUMMY_SCRYPT_HASH = hashPassword(crypto.randomBytes(24).toString("hex"));
  function deriveDefaultUsername(email, name) {
    const fromEmail = (email || "").split("@")[0]?.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
    if (fromEmail) return fromEmail;
    return (name || "user").split(",")[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
  }
  const defaultPasswordCheckCache = /* @__PURE__ */ new Map();
  function isDefaultTestingPasswordHash(storedHash) {
    if (!storedHash) return false;
    const cached = defaultPasswordCheckCache.get(storedHash);
    if (cached !== void 0) return cached;
    const result = verifyPassword(DEFAULT_TESTING_PASSWORD, storedHash);
    if (defaultPasswordCheckCache.size > 500) {
      defaultPasswordCheckCache.clear();
    }
    defaultPasswordCheckCache.set(storedHash, result);
    return result;
  }
  function sanitizeUser(user) {
    const effectiveHash = user.passwordHash || user.password_hash;
    const isUsingDefaultPassword = isDefaultTestingPasswordHash(effectiveHash);
    const { passwordHash: _removed, ...safeUser } = user;
    delete safeUser.password_hash;
    const resolvedStatus = safeUser.accountStatus || (safeUser.isActive === false ? "Nonaktif" : "Aktif");
    return {
      ...safeUser,
      username: safeUser.username || deriveDefaultUsername(safeUser.email, safeUser.name),
      accountStatus: resolvedStatus,
      isActive: resolvedStatus === "Aktif",
      permissions: normalizeRolePermissions(safeUser.role, safeUser.permissions),
      mustChangePassword: Boolean(safeUser.mustChangePassword ?? isUsingDefaultPassword)
    };
  }
  function ensureUserSecurityFieldsInitialized() {
    const current = db.getData();
    const isMysqlMode = db.isMysqlReady() || db.isStrictMysqlRequired();
    if (isMysqlMode) {
      const usedUsernames = /* @__PURE__ */ new Set();
      for (const u of current.users || []) {
        let baseUsername = (u.username || deriveDefaultUsername(u.email, u.name)).toLowerCase();
        if (!baseUsername) baseUsername = `user.${u.id}`;
        let candidate = baseUsername;
        let counter = 2;
        while (usedUsernames.has(candidate)) {
          candidate = `${baseUsername}${counter}`;
          counter += 1;
        }
        usedUsernames.add(candidate);
        u.username = candidate;
        if (!u.accountStatus) {
          u.accountStatus = u.isActive === false ? "Nonaktif" : "Aktif";
        }
        u.isActive = u.accountStatus === "Aktif";
        u.permissions = normalizeRolePermissions(u.role, u.permissions);
        const existingLegacyHash = u.password_hash;
        if (!u.passwordHash && typeof existingLegacyHash === "string" && existingLegacyHash.trim()) {
          u.passwordHash = existingLegacyHash.trim();
        }
        if (u.mustChangePassword === void 0) {
          u.mustChangePassword = false;
        }
      }
      db.syncCleanBaseline();
      return;
    }
    const needsInit = (current.users || []).some(
      (u) => !u.passwordHash && !u.password_hash || !u.username || !u.accountStatus || !u.permissions || u.mustChangePassword === void 0
    );
    if (!needsInit) return;
    const defaultHash = hashPassword(DEFAULT_TESTING_PASSWORD);
    db.update((draft) => {
      const usedUsernames = /* @__PURE__ */ new Set();
      for (const u of draft.users || []) {
        let baseUsername = (u.username || deriveDefaultUsername(u.email, u.name)).toLowerCase();
        if (!baseUsername) baseUsername = `user.${u.id}`;
        let candidate = baseUsername;
        let counter = 2;
        while (usedUsernames.has(candidate)) {
          candidate = `${baseUsername}${counter}`;
          counter += 1;
        }
        usedUsernames.add(candidate);
        u.username = candidate;
        if (!u.accountStatus) {
          u.accountStatus = u.isActive === false ? "Nonaktif" : "Aktif";
        }
        u.isActive = u.accountStatus === "Aktif";
        u.permissions = normalizeRolePermissions(u.role, u.permissions);
        const existingLegacyHash = u.password_hash;
        if (!u.passwordHash && typeof existingLegacyHash === "string" && existingLegacyHash.trim()) {
          u.passwordHash = existingLegacyHash.trim();
        }
        if (!u.passwordHash) {
          u.passwordHash = defaultHash;
          u.passwordUpdatedAt = u.createdAt || (/* @__PURE__ */ new Date()).toISOString();
          u.mustChangePassword = true;
        } else if (u.mustChangePassword === void 0) {
          u.mustChangePassword = verifyPassword(DEFAULT_TESTING_PASSWORD, u.passwordHash);
        }
      }
    });
  }
  if (db.isOperational()) {
    ensureUserSecurityFieldsInitialized();
    if (!db.isMysqlReady() && !db.isStrictMysqlRequired()) {
      await db.flushWrites();
    }
  }
  function computeTokenHmac(payloadB64, user) {
    const userStateBinding = `${user.id}:${user.role}:${user.accountStatus || "Aktif"}:${user.isActive !== false}:${user.passwordHash || ""}`;
    return crypto.createHmac("sha256", `${SESSION_HMAC_SECRET}:${userStateBinding}`).update(payloadB64).digest();
  }
  function pruneSessionMaps(nowMs = Date.now()) {
    if (revokedTokens.size > 2e3) {
      for (const [tok, expAt] of revokedTokens.entries()) {
        if (nowMs > expAt) revokedTokens.delete(tok);
      }
    }
    if (activeSessions.size > 2e3) {
      for (const [tok, sess] of activeSessions.entries()) {
        if (nowMs - new Date(sess.createdAt).getTime() > SESSION_TTL_MS) {
          activeSessions.delete(tok);
        }
      }
    }
  }
  function revokeToken(token) {
    if (!token) return;
    activeSessions.delete(token);
    revokedTokens.set(token, Date.now() + SESSION_TTL_MS);
    pruneSessionMaps();
  }
  function revokeAllSessionsForUser(userId) {
    const expAt = Date.now() + SESSION_TTL_MS;
    for (const [tok, sess] of activeSessions.entries()) {
      if (sess.userId === userId) {
        activeSessions.delete(tok);
        revokedTokens.set(tok, expAt);
      }
    }
    pruneSessionMaps();
  }
  function isTokenRevoked(token) {
    const expAt = revokedTokens.get(token);
    if (expAt === void 0) return false;
    if (Date.now() > expAt) {
      revokedTokens.delete(token);
      return false;
    }
    return true;
  }
  function createSessionToken(user) {
    const nowMs = Date.now();
    pruneSessionMaps(nowMs);
    const payload = {
      uid: user.id,
      jti: crypto.randomBytes(16).toString("hex"),
      iat: nowMs,
      exp: nowMs + SESSION_TTL_MS
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
    const sigHex = computeTokenHmac(payloadB64, user).toString("hex");
    const token = `${payloadB64}.${sigHex}`;
    activeSessions.set(token, { userId: user.id, createdAt: new Date(nowMs).toISOString() });
    return token;
  }
  function authenticateBearerToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return null;
    }
    const token = authHeader.slice(7).trim();
    if (!token || isTokenRevoked(token)) {
      return null;
    }
    const data = db.getData();
    if (token.includes(".")) {
      const parts = token.split(".");
      if (parts.length !== 2) return null;
      const [payloadB64, sigHex] = parts;
      try {
        const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
        if (!decoded || typeof decoded.uid !== "string" || typeof decoded.exp !== "number") {
          return null;
        }
        const nowMs = Date.now();
        if (nowMs > decoded.exp) {
          activeSessions.delete(token);
          return null;
        }
        const user = data.users.find((u) => u.id === decoded.uid);
        if (!user || user.isActive === false || user.accountStatus === "Nonaktif" || user.accountStatus === "Ditangguhkan") {
          return null;
        }
        const expectedSig = computeTokenHmac(payloadB64, user);
        const providedSig = Buffer.from(sigHex, "hex");
        if (expectedSig.length !== providedSig.length || !crypto.timingSafeEqual(expectedSig, providedSig)) {
          return null;
        }
        if (decoded.exp - nowMs < SESSION_REFRESH_WINDOW_MS) {
          req.shouldRefreshSessionToken = true;
        }
        return user;
      } catch {
        return null;
      }
    }
    const session = activeSessions.get(token);
    if (session) {
      const ageMs = Date.now() - new Date(session.createdAt).getTime();
      if (ageMs > SESSION_TTL_MS) {
        activeSessions.delete(token);
        return null;
      }
      const sessionUser = data.users.find((u) => u.id === session.userId);
      if (sessionUser && sessionUser.isActive !== false && sessionUser.accountStatus !== "Nonaktif" && sessionUser.accountStatus !== "Ditangguhkan") {
        return sessionUser;
      }
    }
    return null;
  }
  function isTrustedMutationOrigin(req) {
    const method = (req.method || "GET").toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return true;
    }
    if (req.headers["x-requested-with"] === "XMLHttpRequest" || typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ")) {
      return true;
    }
    const originHeader = String(req.headers.origin || "").trim();
    if (!originHeader || originHeader === "null") {
      return true;
    }
    try {
      const parsedOrigin = new URL(originHeader);
      const originHost = parsedOrigin.host.toLowerCase();
      const originHostname = parsedOrigin.hostname.toLowerCase().replace(/^www\./, "");
      const reqHost = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().toLowerCase();
      const reqHostname = reqHost.split(":")[0].replace(/^www\./, "");
      if (reqHost && (originHost === reqHost || originHostname === reqHostname)) {
        return true;
      }
      if (originHostname === "localhost" || originHostname === "127.0.0.1" || originHostname.endsWith(".run.app") || originHostname.endsWith(".google.com") || originHostname.endsWith(".usercontent.goog") || originHostname.endsWith(".hostingersite.com") || originHostname.endsWith(".hostinger.com")) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
  const PUBLIC_API_PATHS = /* @__PURE__ */ new Set([
    "/health",
    "/auth/login",
    "/auth/register",
    "/register",
    "/auth/signup"
  ]);
  app.get("/api/health", async (_req, res) => {
    const diag = db.getDiagnostics();
    res.status(diag.operational ? 200 : 503).json({
      status: diag.operational ? "ok" : "unavailable",
      database: diag,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  app.use("/api", async (req, res, next) => {
    if (req.path === "/health") {
      return next();
    }
    const methodUpper = (req.method || "GET").toUpperCase();
    const isWriteMethod = methodUpper === "POST" || methodUpper === "PUT" || methodUpper === "PATCH" || methodUpper === "DELETE";
    if (isWriteMethod) {
      console.log(`[WRITE] WRITE REQUEST RECEIVED: ${methodUpper} /api${req.path}`);
    }
    if (!db.isOperational()) {
      await db.ready();
      if (!db.isOperational()) {
        if (isWriteMethod) {
          console.error(
            `[WRITE] DATABASE UNAVAILABLE: ${methodUpper} /api${req.path} rejected (503)`
          );
        }
        return res.status(503).json({
          error: "Database utama sedang tidak dapat dijangkau. Permintaan ditangguhkan sementara untuk melindungi integritas data."
        });
      }
      ensureUserSecurityFieldsInitialized();
    } else {
      void db.retryMysqlIfNeeded().then((reconnected) => {
        if (reconnected) {
          ensureUserSecurityFieldsInitialized();
        }
      }).catch(() => {
      });
    }
    if (db.isMysqlReady()) {
      const refreshedFromMysql = await db.refreshFromMysqlIfStale(1500);
      if (refreshedFromMysql) {
        ensureUserSecurityFieldsInitialized();
      }
    }
    if (isWriteMethod) {
      const originalSend = res.send.bind(res);
      let sendIntercepted = false;
      const isSessionAuditOnlyRoute = req.path === "/auth/login" || req.path === "/auth/logout";
      res.send = ((body) => {
        if (sendIntercepted) {
          return originalSend(body);
        }
        sendIntercepted = true;
        if (isSessionAuditOnlyRoute) {
          if (db.hasUncommittedChanges()) {
            void db.commitPendingWrites(`${methodUpper} /api${req.path} [session]`).catch(() => {
              db.rollbackUncommittedChanges();
            }).finally(() => {
              originalSend(body);
            });
            return res;
          }
          return originalSend(body);
        }
        if (res.statusCode < 400) {
          console.log(
            `[WRITE] AUTHORIZED & VALIDATED: ${methodUpper} /api${req.path} (status=${res.statusCode})`
          );
          if (!db.hasUncommittedChanges()) {
            return originalSend(body);
          }
          void db.commitPendingWrites(`${methodUpper} /api${req.path}`).then(() => {
            originalSend(body);
          }).catch((commitErr) => {
            const errStatus = Number(commitErr?.httpStatus || commitErr?.status || 500);
            const errMsg = commitErr?.userMessage || "[DATABASE WRITE ERROR] Gagal menyimpan perubahan ke database MySQL produksi. Perubahan dibatalkan.";
            res.status(errStatus);
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            originalSend(
              JSON.stringify({
                error: errMsg,
                errorCategory: commitErr?.errorCategory || "DATABASE_WRITE_ERROR",
                failedTable: commitErr?.failedTable || void 0,
                mysqlErrorCode: commitErr?.code || void 0
              })
            );
          });
          return res;
        }
        console.warn(
          `[WRITE] REJECTED BEFORE COMMIT: ${methodUpper} /api${req.path} (status=${res.statusCode})`
        );
        if (db.hasUncommittedChanges()) {
          void db.commitPendingWrites(`${methodUpper} /api${req.path} [audit]`).catch(() => {
            db.rollbackUncommittedChanges();
          }).finally(() => {
            originalSend(body);
          });
          return res;
        }
        return originalSend(body);
      });
    }
    const rawForwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    const clientIp = rawForwarded || String(req.socket.remoteAddress || "local");
    const authTokenTail = typeof req.headers.authorization === "string" && req.headers.authorization.length > 20 ? req.headers.authorization.slice(-16) : "anon";
    const rateKey = `${clientIp}:${authTokenTail}`;
    const nowMs = Date.now();
    const rateWindow = apiRateLimits.get(rateKey);
    if (!rateWindow || nowMs - rateWindow.windowStart > 6e4) {
      if (apiRateLimits.size > 2e3) {
        for (const [k, v] of apiRateLimits.entries()) {
          if (nowMs - v.windowStart > 6e4) apiRateLimits.delete(k);
        }
      }
      apiRateLimits.set(rateKey, { count: 1, windowStart: nowMs });
    } else {
      rateWindow.count += 1;
      if (rateWindow.count > 600) {
        return res.status(429).json({
          error: "Terlalu banyak permintaan API dari jaringan Anda. Silakan tunggu beberapa saat."
        });
      }
    }
    if (!isTrustedMutationOrigin(req)) {
      return res.status(403).json({
        error: "Permintaan lintas domain (Cross-Origin) tidak diizinkan demi keamanan sesi Anda."
      });
    }
    if (req.body && typeof req.body === "object") {
      req.body = sanitizePayloadDeep(req.body);
    }
    if (PUBLIC_API_PATHS.has(req.path)) {
      return next();
    }
    const verifiedUser = authenticateBearerToken(req);
    if (!verifiedUser) {
      if (isWriteMethod) {
        console.warn(`[WRITE] UNAUTHENTICATED: ${methodUpper} /api${req.path} rejected (401)`);
      }
      return res.status(401).json({
        error: "Sesi otentikasi tidak valid atau telah berakhir. Silakan login kembali menggunakan kredensial resmi Anda."
      });
    }
    if (isWriteMethod) {
      console.log(
        `[WRITE] AUTHENTICATED: ${methodUpper} /api${req.path} (user=${verifiedUser.id}, role=${verifiedUser.role})`
      );
    }
    if (req.shouldRefreshSessionToken && req.path !== "/auth/logout" && req.path !== "/auth/change-password") {
      res.setHeader("X-Refreshed-Token", createSessionToken(verifiedUser));
    }
    req.authenticatedUser = verifiedUser;
    next();
  });
  function getCurrentUser(req) {
    const verified = req.authenticatedUser || authenticateBearerToken(req);
    if (!verified) {
      throw Object.assign(new Error("Unauthorized access attempt."), { status: 401 });
    }
    return verified;
  }
  function canUserAccessTorRecord(user, tor, data) {
    if (user.role !== "staff" || user.permissions?.canViewAllTors) {
      return true;
    }
    if (tor.picId === user.id || tor.createdById === user.id) {
      return true;
    }
    const raci = data.outputRaciRecords?.[tor.outputId];
    if (raci && (raci.responsibleUserId === user.id || raci.accountableUserId === user.id || raci.accountableFinanceUserId === user.id || (raci.consultedUsers || []).includes(user.name) || (raci.informedUsers || []).includes(user.name))) {
      return true;
    }
    return false;
  }
  function getConnectedBudgetRequested(tor, cashAdvances = []) {
    const approvedCas = (cashAdvances || []).filter(
      (ca) => ca.torId === tor.id && (ca.status === "Disetujui" || ca.status === "Dicairkan")
    );
    if (approvedCas.length > 0) {
      return approvedCas.reduce((sum, ca) => sum + (Number(ca.totalAmount) || 0), 0);
    }
    return 0;
  }
  function syncTorBudgetInDraft(draft, torId) {
    const torIdx = (draft.tors || []).findIndex((t) => t.id === torId);
    if (torIdx === -1) return;
    const approvedCas = (draft.cashAdvances || []).filter(
      (ca) => ca.torId === torId && (ca.status === "Disetujui" || ca.status === "Dicairkan")
    );
    draft.tors[torIdx].budgetRequested = approvedCas.reduce(
      (sum, ca) => sum + (Number(ca.totalAmount) || 0),
      0
    );
    const verifiedReportCas = approvedCas.filter(
      (ca) => ca.isReported && ca.reportApprovalStatus === "Telah Disetujui"
    );
    draft.tors[torIdx].budgetActualSpent = verifiedReportCas.reduce(
      (sum, ca) => sum + (Number(ca.realizedAmount ?? ca.totalAmount) || 0),
      0
    );
  }
  function normalizeRolePermissions(role, rawPermissions) {
    const defaults = {
      admin: {
        canManagePrograms: false,
        canCreateTor: false,
        canApproveTor: false,
        canManageUsers: true,
        canViewAllTors: true
      },
      director: {
        canManagePrograms: true,
        canCreateTor: true,
        canApproveTor: true,
        canManageUsers: false,
        canViewAllTors: true
      },
      hr: {
        canManagePrograms: false,
        canCreateTor: true,
        canApproveTor: false,
        canManageUsers: false,
        canViewAllTors: true
      },
      finance: {
        canManagePrograms: false,
        canCreateTor: true,
        canApproveTor: true,
        canManageUsers: false,
        canViewAllTors: true
      },
      program_manager: {
        canManagePrograms: true,
        canCreateTor: true,
        canApproveTor: true,
        canManageUsers: false,
        canViewAllTors: true
      },
      meal: {
        canManagePrograms: true,
        canCreateTor: true,
        canApproveTor: false,
        canManageUsers: false,
        canViewAllTors: true
      },
      staff: {
        canManagePrograms: false,
        canCreateTor: true,
        canApproveTor: false,
        canManageUsers: false,
        canViewAllTors: false
      }
    };
    const base = defaults[role] || defaults.staff;
    const merged = {
      canManagePrograms: rawPermissions?.canManagePrograms ?? base.canManagePrograms,
      canCreateTor: rawPermissions?.canCreateTor ?? base.canCreateTor,
      canApproveTor: rawPermissions?.canApproveTor ?? base.canApproveTor,
      canManageUsers: rawPermissions?.canManageUsers ?? base.canManageUsers,
      canViewAllTors: rawPermissions?.canViewAllTors ?? base.canViewAllTors
    };
    if (role === "admin") {
      merged.canApproveTor = false;
      merged.canManageUsers = true;
    }
    return merged;
  }
  function cascadeSyncUserIdentityAcrossSystem(draft, updatedUser, previousName) {
    const nameChanged = previousName && previousName !== updatedUser.name;
    if (draft.outputRaciRecords) {
      for (const raci of Object.values(draft.outputRaciRecords)) {
        if (raci.responsibleUserId === updatedUser.id) {
          raci.responsibleUserName = updatedUser.name;
        }
        if (raci.accountableUserId === updatedUser.id) {
          raci.accountableUserName = updatedUser.name;
        }
        if (raci.accountableFinanceUserId === updatedUser.id) {
          raci.accountableFinanceUserName = updatedUser.name;
        }
        if (raci.assignedById === updatedUser.id) {
          raci.assignedByName = updatedUser.name;
        }
        if (raci.approvedById === updatedUser.id) {
          raci.approvedByName = updatedUser.name;
        }
        if (nameChanged && Array.isArray(raci.consultedUsers)) {
          raci.consultedUsers = raci.consultedUsers.map(
            (cName) => cName === previousName ? updatedUser.name : cName
          );
        }
        if (nameChanged && Array.isArray(raci.informedUsers)) {
          raci.informedUsers = raci.informedUsers.map(
            (iName) => iName === previousName ? updatedUser.name : iName
          );
        }
      }
    }
    if (draft.activityMonitoringRecords) {
      for (const actRec of Object.values(draft.activityMonitoringRecords)) {
        if (actRec.updatedById === updatedUser.id) {
          actRec.updatedByName = updatedUser.name;
        }
        if (Array.isArray(actRec.tools)) {
          for (const t of actRec.tools) {
            if (t.assignedById === updatedUser.id) {
              t.assignedByName = updatedUser.name;
            }
          }
        }
      }
    }
    if (draft.monitoringReports) {
      for (const rep of Object.values(draft.monitoringReports)) {
        if (rep.responsibleUserId === updatedUser.id || nameChanged && rep.responsibleName === previousName) {
          rep.responsibleName = updatedUser.name;
        }
        if (rep.updatedById === updatedUser.id) {
          rep.updatedByName = updatedUser.name;
        }
      }
    }
    if (nameChanged) {
      for (const prog of draft.programs || []) {
        if (prog.picName === previousName) prog.picName = updatedUser.name;
      }
      for (const outc of draft.outcomes || []) {
        if (outc.picName === previousName) outc.picName = updatedUser.name;
      }
      for (const outp of draft.outputs || []) {
        if (outp.picName === previousName) outp.picName = updatedUser.name;
      }
      for (const act of draft.activities || []) {
        if (act.picName === previousName) act.picName = updatedUser.name;
      }
      for (const sub of draft.subActivities || []) {
        if (sub.picName === previousName) sub.picName = updatedUser.name;
      }
    }
    for (const tor of draft.tors || []) {
      if (tor.createdById === updatedUser.id) {
        tor.createdByName = updatedUser.name;
      }
      if (nameChanged && tor.picName === previousName) {
        tor.picName = updatedUser.name;
      }
    }
    for (const ca of draft.cashAdvances || []) {
      if (ca.requesterId === updatedUser.id) {
        ca.requesterName = updatedUser.name;
        ca.requesterRole = updatedUser.roleTitle;
      }
    }
    if (draft.attendanceSystem) {
      for (const rec of draft.attendanceSystem.records || []) {
        if (rec.userId === updatedUser.id) {
          rec.userName = updatedUser.name;
          rec.userRoleTitle = updatedUser.roleTitle;
          rec.department = updatedUser.department;
        }
      }
      for (const wfa of draft.attendanceSystem.wfaRequests || []) {
        if (wfa.userId === updatedUser.id) {
          wfa.userName = updatedUser.name;
          wfa.userRoleTitle = updatedUser.roleTitle;
        }
      }
      for (const lv of draft.attendanceSystem.leaveRequests || []) {
        if (lv.userId === updatedUser.id) {
          lv.userName = updatedUser.name;
          lv.userRoleTitle = updatedUser.roleTitle;
        }
      }
      for (const flx of draft.attendanceSystem.flextimeAssignments || []) {
        if (flx.userId === updatedUser.id) {
          flx.userName = updatedUser.name;
          flx.userRoleTitle = updatedUser.roleTitle;
        }
      }
    }
  }
  const handleBlockedPublicRegistration = (req, res) => {
    const attemptedEmail = String(req.body?.email || req.body?.username || "Tidak diketahui").trim();
    db.update((d) => {
      d.auditLogs.unshift({
        id: `log-sec-reg-${Date.now()}`,
        actorId: "anonymous",
        actorName: "Akses Eksternal / Publik",
        actorRole: "Unauthenticated",
        action: "Percobaan Registrasi Mandiri Ditolak",
        entityType: "USER",
        entityId: "closed-registration",
        details: `Percobaan pembuatan akun publik ditolak untuk identitas "${attemptedEmail}". Sistem menerapkan Closed Registration System (hanya System Administrator yang berwenang membuat akun).`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    });
    return res.status(403).json({
      error: "Pendaftaran akun mandiri ditutup (Closed Registration System). Seluruh akun pengguna dikelola secara eksklusif oleh System Administrator WIJNA."
    });
  };
  app.post("/api/auth/register", handleBlockedPublicRegistration);
  app.post("/api/register", handleBlockedPublicRegistration);
  app.post("/api/auth/signup", handleBlockedPublicRegistration);
  app.post("/api/auth/login", async (req, res) => {
    const rawIdentifier = String(req.body?.identifier || req.body?.username || req.body?.email || "").trim().toLowerCase();
    const rawPassword = String(req.body?.password || "");
    if (!rawIdentifier || !rawPassword) {
      return res.status(400).json({
        error: "Username/Email dan Password wajib diisi."
      });
    }
    const rawForwardedIp = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    const clientIp = (rawForwardedIp || String(req.socket.remoteAddress || "local")).slice(0, 64);
    const rateKey = `${clientIp}:${rawIdentifier.slice(0, 120)}`;
    const nowMs = Date.now();
    if (loginRateLimits.size > 2e3) {
      for (const [k, v] of loginRateLimits.entries()) {
        if (nowMs - v.firstAttemptAt > 15 * 60 * 1e3 && (!v.lockedUntil || nowMs >= v.lockedUntil)) {
          loginRateLimits.delete(k);
        }
      }
    }
    const rateEntry = loginRateLimits.get(rateKey);
    if (rateEntry?.lockedUntil && nowMs < rateEntry.lockedUntil) {
      const waitSec = Math.ceil((rateEntry.lockedUntil - nowMs) / 1e3);
      return res.status(429).json({
        error: `Terlalu banyak percobaan login yang gagal. Silakan tunggu ${waitSec} detik sebelum mencoba kembali.`
      });
    }
    const recordFailedAttempt = () => {
      const prev = loginRateLimits.get(rateKey);
      const windowMs = 15 * 60 * 1e3;
      if (!prev || nowMs - prev.firstAttemptAt > windowMs) {
        loginRateLimits.set(rateKey, { count: 1, firstAttemptAt: nowMs });
      } else {
        const nextCount = prev.count + 1;
        loginRateLimits.set(rateKey, {
          count: nextCount,
          firstAttemptAt: prev.firstAttemptAt,
          lockedUntil: nextCount >= 10 ? nowMs + 5 * 60 * 1e3 : void 0
        });
      }
    };
    await db.refreshUsersFromMysql(true);
    const data = db.getData();
    const targetUser = data.users.find((u) => {
      const uEmail = (u.email || "").trim().toLowerCase();
      const uUsername = (u.username || deriveDefaultUsername(u.email, u.name)).trim().toLowerCase();
      return uEmail === rawIdentifier || uUsername === rawIdentifier;
    });
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    if (!targetUser) {
      verifyPassword(rawPassword, DUMMY_SCRYPT_HASH);
      recordFailedAttempt();
      db.update((d) => {
        d.auditLogs.unshift({
          id: `log-login-fail-${Date.now()}`,
          actorId: "anonymous",
          actorName: rawIdentifier,
          actorRole: "Unauthenticated",
          action: "Percobaan Login Gagal",
          entityType: "USER",
          entityId: "auth-login",
          details: `Percobaan login gagal: Username atau email "${rawIdentifier}" tidak ditemukan dalam sistem.`,
          timestamp: nowIso
        });
      });
      return res.status(401).json({
        error: "Kredensial tidak valid. Periksa kembali Username/Email dan Password Anda."
      });
    }
    const resolvedStatus = targetUser.accountStatus || (targetUser.isActive === false ? "Nonaktif" : "Aktif");
    if (resolvedStatus !== "Aktif" || targetUser.isActive === false) {
      verifyPassword(rawPassword, DUMMY_SCRYPT_HASH);
      db.update((d) => {
        d.auditLogs.unshift({
          id: `log-login-blocked-${Date.now()}`,
          actorId: targetUser.id,
          actorName: targetUser.name,
          actorRole: targetUser.roleTitle,
          action: "Percobaan Login Akun Nonaktif/Ditangguhkan",
          entityType: "USER",
          entityId: targetUser.id,
          details: `Percobaan login ditolak karena status akun "${targetUser.name}" sedang ${resolvedStatus}.`,
          timestamp: nowIso
        });
      });
      return res.status(403).json({
        error: resolvedStatus === "Ditangguhkan" ? `Akun "${targetUser.name}" sedang ditangguhkan sementara (Suspended). Silakan hubungi System Administrator.` : `Akun "${targetUser.name}" telah dinonaktifkan. Silakan hubungi System Administrator.`
      });
    }
    const effectiveStoredHash = targetUser.passwordHash || targetUser.password_hash;
    const verification = verifyPasswordWithMigration(rawPassword, effectiveStoredHash);
    if (!verification.valid) {
      recordFailedAttempt();
      db.update((d) => {
        d.auditLogs.unshift({
          id: `log-login-wrongpw-${Date.now()}`,
          actorId: targetUser.id,
          actorName: targetUser.name,
          actorRole: targetUser.roleTitle,
          action: "Percobaan Login Gagal (Password Salah)",
          entityType: "USER",
          entityId: targetUser.id,
          details: `Percobaan login gagal untuk akun ${targetUser.name} (${targetUser.email}): Password tidak sesuai.`,
          timestamp: nowIso
        });
      });
      return res.status(401).json({
        error: "Kredensial tidak valid. Periksa kembali Username/Email dan Password Anda."
      });
    }
    loginRateLimits.delete(rateKey);
    let loggedInUser = targetUser;
    const upgradedHash = verification.needsRehash ? hashPassword(rawPassword) : void 0;
    db.update((d) => {
      d.currentUserId = targetUser.id;
      const idx = d.users.findIndex((u) => u.id === targetUser.id);
      if (idx !== -1) {
        d.users[idx].lastLoginAt = nowIso;
        if (upgradedHash) {
          d.users[idx].passwordHash = upgradedHash;
          d.users[idx].passwordUpdatedAt = d.users[idx].passwordUpdatedAt || nowIso;
        }
        loggedInUser = d.users[idx];
      }
      d.auditLogs.unshift({
        id: `log-login-ok-${Date.now()}`,
        actorId: targetUser.id,
        actorName: targetUser.name,
        actorRole: targetUser.roleTitle,
        action: "Login Sistem Berhasil",
        entityType: "USER",
        entityId: targetUser.id,
        details: `Pengguna ${targetUser.name} (${targetUser.roleTitle} \xB7 ${targetUser.department}) berhasil login ke sistem.`,
        timestamp: nowIso
      });
    });
    await db.syncUserImmediately(loggedInUser, {
      bestEffortMetadataOnly: true,
      contextLabel: "POST /api/auth/login [metadata]"
    });
    loggedInUser = db.getData().users.find((u) => u.id === targetUser.id) || targetUser;
    const sessionToken = createSessionToken(loggedInUser);
    res.json({
      message: `Selamat datang kembali, ${loggedInUser.name}`,
      user: sanitizeUser(loggedInUser),
      token: sessionToken
    });
  });
  app.post("/api/auth/change-password", async (req, res) => {
    const currentUser = getCurrentUser(req);
    if (!currentUser || currentUser.isActive === false) {
      return res.status(401).json({ error: "Sesi pengguna tidak valid atau akun sedang nonaktif." });
    }
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "").trim();
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: "Password saat ini dan password baru wajib diisi."
      });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({
        error: "Password baru minimal harus terdiri dari 6 karakter."
      });
    }
    await db.refreshUsersFromMysql(true);
    const data = db.getData();
    const targetUser = data.users.find((u) => u.id === currentUser.id);
    if (!targetUser) {
      return res.status(404).json({ error: "Akun pengguna tidak ditemukan." });
    }
    const storedHash = targetUser.passwordHash || targetUser.password_hash;
    if (!verifyPassword(currentPassword, storedHash)) {
      return res.status(401).json({
        error: "Password saat ini yang Anda masukkan tidak sesuai."
      });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({
        error: "Password baru harus berbeda dari password saat ini."
      });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const newHash = hashPassword(newPassword);
    let updatedUser = targetUser;
    db.update((d) => {
      const idx = d.users.findIndex((u) => u.id === currentUser.id);
      if (idx !== -1) {
        d.users[idx].passwordHash = newHash;
        d.users[idx].passwordUpdatedAt = nowIso;
        d.users[idx].mustChangePassword = false;
        updatedUser = d.users[idx];
      }
      d.auditLogs.unshift({
        id: `log-pwchange-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: "Perubahan Password Akun Mandiri",
        entityType: "USER",
        entityId: currentUser.id,
        details: `Pengguna ${currentUser.name} (@${currentUser.username || deriveDefaultUsername(currentUser.email, currentUser.name)} \xB7 ${currentUser.roleTitle}) telah mengganti password akunnya secara mandiri.`,
        timestamp: nowIso
      });
    });
    await db.syncUserImmediately(updatedUser);
    revokeAllSessionsForUser(currentUser.id);
    const freshToken = createSessionToken(updatedUser);
    res.json({
      message: "Password akun Anda berhasil diperbarui dan dienkripsi.",
      user: sanitizeUser(updatedUser),
      token: freshToken
    });
  });
  app.post("/api/auth/logout", (req, res) => {
    const currentUser = getCurrentUser(req);
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      revokeToken(token);
    }
    if (currentUser) {
      db.update((d) => {
        d.auditLogs.unshift({
          id: `log-logout-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: "Logout Sistem",
          entityType: "USER",
          entityId: currentUser.id,
          details: `Pengguna ${currentUser.name} (${currentUser.roleTitle}) keluar dari sesi sistem.`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      });
    }
    res.json({ message: "Sesi berhasil diakhiri." });
  });
  app.get("/api/auth/current-user", async (req, res) => {
    await db.refreshUsersFromMysql(false);
    const user = getCurrentUser(req);
    if (user.isActive === false) {
      return res.status(403).json({ error: "Akun pengguna sedang dinonaktifkan." });
    }
    res.json(sanitizeUser(user));
  });
  app.post("/api/auth/switch-user", async (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== "admin" && !currentUser.permissions?.canManageUsers) {
      return res.status(403).json({
        error: "Fitur peralihan sesi tanpa password telah dinonaktifkan demi keamanan produksi. Silakan login menggunakan kredensial resmi."
      });
    }
    await db.refreshUsersFromMysql(false);
    const { userId } = req.body;
    const data = db.getData();
    const user = data.users.find((u) => u.id === userId);
    if (!user) {
      return res.status(404).json({ error: "Pengguna tidak ditemukan" });
    }
    if (user.isActive === false) {
      return res.status(403).json({
        error: `Akun "${user.name}" sedang ${user.accountStatus || "dinonaktifkan"} dan tidak dapat digunakan untuk mengakses sistem.`
      });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    let updatedTarget = user;
    db.update((d) => {
      d.currentUserId = user.id;
      const idx = d.users.findIndex((u) => u.id === user.id);
      if (idx !== -1) {
        d.users[idx].lastLoginAt = nowIso;
        updatedTarget = d.users[idx];
      }
    });
    await db.syncUserImmediately(updatedTarget, {
      bestEffortMetadataOnly: true,
      contextLabel: "POST /api/auth/switch-user [metadata]"
    });
    updatedTarget = db.getData().users.find((u) => u.id === user.id) || user;
    const sessionToken = createSessionToken(updatedTarget);
    res.json({
      message: `Berhasil beralih ke ${user.name} (${user.roleTitle})`,
      user: sanitizeUser(updatedTarget),
      token: sessionToken
    });
  });
  app.get("/api/users", async (_req, res) => {
    await db.refreshUsersFromMysql(false);
    const data = db.getData();
    res.json((data.users || []).map(sanitizeUser));
  });
  app.get("/api/organization-settings", (_req, res) => {
    const data = db.getData();
    const orgSettings = data.organizationSettings || {
      organizationName: "Yayasan Inti Muda Indonesia (WIJNA)",
      sidebarBrandName: "Yayasan Inti Muda Indonesia (WIJNA)",
      sidebarSubtitle: "HR & Program System"
    };
    res.json(orgSettings);
  });
  app.put("/api/organization-settings", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== "admin" && currentUser.role !== "director" && !currentUser.permissions?.canManageUsers) {
      return res.status(403).json({
        error: "Akses ditolak: Hanya System Administrator atau Direktur yang berwenang mengubah pengaturan organisasi terpusat."
      });
    }
    const body = req.body || {};
    const organizationName = String(body.organizationName || "").trim() || "Yayasan Inti Muda Indonesia (WIJNA)";
    const sidebarBrandName = String(body.sidebarBrandName || "").trim() || organizationName;
    const sidebarSubtitle = String(body.sidebarSubtitle || "").trim() || "HR & Program System";
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    let savedSettings = null;
    db.update((draft) => {
      savedSettings = {
        organizationName,
        sidebarBrandName,
        sidebarSubtitle,
        updatedAt: nowIso,
        updatedByName: body.updatedByName || currentUser.name
      };
      draft.organizationSettings = savedSettings;
      if (Array.isArray(draft.cashAdvances)) {
        draft.cashAdvances.forEach((ca) => {
          ca.organizationName = organizationName;
        });
      }
      draft.auditLogs.unshift({
        id: `log-org-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.role,
        action: "Pengaturan Nama Organisasi Terpusat",
        entityType: "USER",
        entityId: "system",
        details: `Memperbarui nama organisasi terpusat menjadi "${organizationName}" (Sidebar: "${sidebarBrandName}").`,
        timestamp: nowIso
      });
    });
    res.json(savedSettings);
  });
  app.post("/api/users", async (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.isActive === false) {
      return res.status(403).json({ error: "Akun Anda sedang nonaktif." });
    }
    if (currentUser.role !== "admin" && !currentUser.permissions?.canManageUsers) {
      db.update((d) => {
        d.auditLogs.unshift({
          id: `log-unauth-create-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: "Percobaan Pembuatan Akun Tanpa Otorisasi",
          entityType: "USER",
          entityId: "unauthorized",
          details: `Pengguna ${currentUser.name} (${currentUser.roleTitle}) mencoba membuat akun baru tanpa hak akses System Administrator.`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      });
      return res.status(403).json({
        error: "Akses ditolak: Hanya System Administrator yang berwenang membuat akun pengguna baru."
      });
    }
    const rawName = String(req.body?.name || "").trim();
    const rawEmail = String(req.body?.email || "").trim().toLowerCase();
    const rawUsernameInput = String(req.body?.username || "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
    const rawInitialPassword = String(req.body?.initialPassword || "").trim();
    const role = req.body?.role;
    const rawRoleTitle = String(req.body?.roleTitle || "").trim();
    const rawDepartment = String(req.body?.department || "").trim();
    const rawPermissions = req.body?.permissions;
    const rawAccountStatus = req.body?.accountStatus;
    if (!rawName || !rawEmail || !role) {
      return res.status(400).json({ error: "Nama lengkap, email, dan peran wajib diisi." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      return res.status(400).json({ error: "Format alamat email tidak valid." });
    }
    const resolvedUsername = rawUsernameInput || deriveDefaultUsername(rawEmail, rawName);
    if (!resolvedUsername || resolvedUsername.length < 3) {
      return res.status(400).json({
        error: "Username minimal terdiri dari 3 karakter (huruf/angka/titik/garis bawah)."
      });
    }
    const passwordToHash = rawInitialPassword || DEFAULT_TESTING_PASSWORD;
    if (passwordToHash.length < 6) {
      return res.status(400).json({
        error: "Password awal minimal harus terdiri dari 6 karakter."
      });
    }
    const validRoles = [
      "admin",
      "director",
      "hr",
      "finance",
      "program_manager",
      "meal",
      "staff"
    ];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: "Role pengguna tidak dikenali oleh sistem." });
    }
    const currentData = db.getData();
    const duplicateEmail = currentData.users.find(
      (u) => u.email.trim().toLowerCase() === rawEmail
    );
    if (duplicateEmail) {
      return res.status(400).json({
        error: `Email "${rawEmail}" sudah terdaftar atas nama ${duplicateEmail.name}. Gunakan email yang berbeda.`
      });
    }
    const duplicateUsername = currentData.users.find(
      (u) => (u.username || deriveDefaultUsername(u.email, u.name)).trim().toLowerCase() === resolvedUsername
    );
    if (duplicateUsername) {
      return res.status(400).json({
        error: `Username "${resolvedUsername}" sudah digunakan oleh ${duplicateUsername.name}. Gunakan username unik.`
      });
    }
    const duplicateName = currentData.users.find(
      (u) => u.name.trim().toLowerCase() === rawName.toLowerCase()
    );
    if (duplicateName) {
      return res.status(400).json({
        error: `Pengguna dengan nama "${rawName}" sudah terdaftar (${duplicateName.email}). Hindari pembuatan akun ganda.`
      });
    }
    const resolvedStatus = rawAccountStatus && ["Aktif", "Ditangguhkan", "Nonaktif"].includes(rawAccountStatus) ? rawAccountStatus : req.body?.isActive === false ? "Nonaktif" : "Aktif";
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const newUser = {
      id: `user-${Date.now()}`,
      username: resolvedUsername,
      name: rawName,
      email: rawEmail,
      role,
      roleTitle: rawRoleTitle || role.toUpperCase(),
      department: rawDepartment || "Staf Lapangan",
      accountStatus: resolvedStatus,
      isActive: resolvedStatus === "Aktif",
      permissions: normalizeRolePermissions(role, rawPermissions),
      createdAt: nowIso,
      passwordUpdatedAt: nowIso,
      passwordHash: hashPassword(passwordToHash),
      mustChangePassword: true
    };
    db.update((d) => {
      d.users.push(newUser);
      d.auditLogs.unshift({
        id: `log-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: "Pembuatan Akun Pengguna",
        entityType: "USER",
        entityId: newUser.id,
        details: `Membuat akun baru: ${newUser.name} (@${newUser.username} \xB7 ${newUser.roleTitle} \xB7 ${newUser.department}) dengan status ${resolvedStatus}.`,
        timestamp: nowIso
      });
    });
    await db.syncUserImmediately(newUser);
    res.status(201).json(sanitizeUser(newUser));
  });
  app.put("/api/users/:id", async (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.isActive === false) {
      return res.status(403).json({ error: "Akun Anda sedang nonaktif." });
    }
    if (currentUser.role !== "admin" && !currentUser.permissions?.canManageUsers) {
      return res.status(403).json({
        error: "Akses ditolak: Hanya System Administrator yang memiliki hak mengelola akun pengguna."
      });
    }
    const { id } = req.params;
    const {
      name,
      email,
      username,
      role,
      roleTitle,
      department,
      isActive,
      accountStatus,
      permissions
    } = req.body;
    const currentData = db.getData();
    const targetUser = currentData.users.find((u) => u.id === id);
    if (!targetUser) {
      return res.status(404).json({ error: "Pengguna tidak ditemukan" });
    }
    const nextName = name !== void 0 ? String(name).trim() : targetUser.name;
    const nextEmail = email !== void 0 ? String(email).trim().toLowerCase() : targetUser.email.toLowerCase();
    const nextUsername = username !== void 0 ? String(username).trim().toLowerCase().replace(/[^a-z0-9._-]/g, "") : targetUser.username || deriveDefaultUsername(targetUser.email, targetUser.name);
    const nextRole = role ?? targetUser.role;
    const allowedUpdateRoles = [
      "admin",
      "director",
      "hr",
      "finance",
      "program_manager",
      "meal",
      "staff"
    ];
    if (!allowedUpdateRoles.includes(nextRole)) {
      return res.status(400).json({ error: "Role pengguna tidak dikenali oleh sistem." });
    }
    let nextAccountStatus = targetUser.accountStatus || (targetUser.isActive === false ? "Nonaktif" : "Aktif");
    if (accountStatus && ["Aktif", "Ditangguhkan", "Nonaktif"].includes(accountStatus)) {
      nextAccountStatus = accountStatus;
    } else if (isActive !== void 0) {
      nextAccountStatus = Boolean(isActive) ? "Aktif" : "Nonaktif";
    }
    const nextIsActive = nextAccountStatus === "Aktif";
    if (!nextName || !nextEmail) {
      return res.status(400).json({ error: "Nama dan email pengguna tidak boleh kosong." });
    }
    if (!nextUsername || nextUsername.length < 3) {
      return res.status(400).json({ error: "Username minimal terdiri dari 3 karakter." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      return res.status(400).json({ error: "Format alamat email tidak valid." });
    }
    const duplicateEmail = currentData.users.find(
      (u) => u.id !== id && u.email.trim().toLowerCase() === nextEmail
    );
    if (duplicateEmail) {
      return res.status(400).json({
        error: `Email "${nextEmail}" sudah digunakan oleh pengguna lain (${duplicateEmail.name}).`
      });
    }
    const duplicateUsername = currentData.users.find(
      (u) => u.id !== id && (u.username || deriveDefaultUsername(u.email, u.name)).trim().toLowerCase() === nextUsername
    );
    if (duplicateUsername) {
      return res.status(400).json({
        error: `Username "${nextUsername}" sudah digunakan oleh akun ${duplicateUsername.name}.`
      });
    }
    const duplicateName = currentData.users.find(
      (u) => u.id !== id && u.name.trim().toLowerCase() === nextName.toLowerCase()
    );
    if (duplicateName) {
      return res.status(400).json({
        error: `Nama "${nextName}" sudah digunakan oleh akun ${duplicateName.email}. Hindari duplikasi nama pengguna.`
      });
    }
    if (!nextIsActive && id === currentUser.id) {
      return res.status(400).json({
        error: "Tidak dapat menonaktifkan atau menangguhkan akun yang sedang Anda gunakan saat ini."
      });
    }
    const activeAdmins = currentData.users.filter(
      (u) => u.isActive && (u.role === "admin" || u.permissions?.canManageUsers)
    );
    const isTargetAdmin = targetUser.role === "admin" || targetUser.permissions?.canManageUsers;
    const willRemainActiveAdmin = nextIsActive && (nextRole === "admin" || permissions?.canManageUsers);
    if (isTargetAdmin && !willRemainActiveAdmin && activeAdmins.length <= 1) {
      return res.status(400).json({
        error: "Sistem wajib memiliki minimal 1 akun Administrator aktif."
      });
    }
    let updatedUser = null;
    db.update((d) => {
      const idx = d.users.findIndex((u) => u.id === id);
      if (idx !== -1) {
        const prevUser = d.users[idx];
        const previousName = prevUser.name;
        const prevStatus = prevUser.accountStatus || (prevUser.isActive === false ? "Nonaktif" : "Aktif");
        const resolvedPermissions = normalizeRolePermissions(
          nextRole,
          permissions !== void 0 ? permissions : prevUser.permissions
        );
        d.users[idx] = {
          ...prevUser,
          username: nextUsername,
          name: nextName,
          email: nextEmail,
          role: nextRole,
          roleTitle: roleTitle !== void 0 ? String(roleTitle).trim() || prevUser.roleTitle : prevUser.roleTitle,
          department: department !== void 0 ? String(department).trim() || prevUser.department : prevUser.department,
          accountStatus: nextAccountStatus,
          isActive: nextIsActive,
          permissions: resolvedPermissions
        };
        updatedUser = d.users[idx];
        cascadeSyncUserIdentityAcrossSystem(d, updatedUser, previousName);
        if (!nextIsActive) {
          revokeAllSessionsForUser(id);
          if (d.currentUserId === id) {
            const fallback = d.users.find((u) => u.isActive && u.role === "director") || d.users.find((u) => u.isActive);
            if (fallback) {
              d.currentUserId = fallback.id;
            }
          }
        }
        const changesSummary = [];
        if (previousName !== updatedUser.name) {
          changesSummary.push(`Nama: "${previousName}" \u2192 "${updatedUser.name}"`);
        }
        if (prevUser.username !== updatedUser.username) {
          changesSummary.push(`Username: @${prevUser.username} \u2192 @${updatedUser.username}`);
        }
        if (prevUser.role !== updatedUser.role) {
          changesSummary.push(`Role: ${prevUser.role} \u2192 ${updatedUser.role}`);
        }
        if (prevStatus !== nextAccountStatus) {
          changesSummary.push(`Status Akun: ${prevStatus} \u2192 ${nextAccountStatus}`);
        }
        const auditActionLabel = prevStatus !== nextAccountStatus ? nextAccountStatus === "Aktif" ? "Aktivasi Akun Pengguna" : nextAccountStatus === "Ditangguhkan" ? "Penangguhan Akun Pengguna (Suspended)" : "Penonaktifan Akun Pengguna" : "Pembaruan Akun Pengguna";
        d.auditLogs.unshift({
          id: `log-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: auditActionLabel,
          entityType: "USER",
          entityId: id,
          details: `Memperbarui akun ${updatedUser.name} (${updatedUser.roleTitle})${changesSummary.length > 0 ? ` \u2014 ${changesSummary.join(", ")}` : ""}`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    });
    if (!updatedUser) {
      return res.status(404).json({ error: "Pengguna tidak ditemukan" });
    }
    await db.syncUserImmediately(updatedUser);
    if (id === currentUser.id && nextIsActive) {
      res.setHeader("X-Refreshed-Token", createSessionToken(updatedUser));
    }
    res.json(sanitizeUser(updatedUser));
  });
  app.post("/api/users/:id/reset-password", async (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.isActive === false) {
      return res.status(403).json({ error: "Akun Anda sedang nonaktif." });
    }
    if (currentUser.role !== "admin" && !currentUser.permissions?.canManageUsers) {
      return res.status(403).json({
        error: "Akses ditolak: Hanya System Administrator yang berwenang mereset password pengguna."
      });
    }
    const { id } = req.params;
    const newPassword = String(req.body?.newPassword || "").trim();
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        error: "Password baru minimal harus terdiri dari 6 karakter."
      });
    }
    const currentData = db.getData();
    const targetUser = currentData.users.find((u) => u.id === id);
    if (!targetUser) {
      return res.status(404).json({ error: "Pengguna tidak ditemukan." });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const newHash = hashPassword(newPassword);
    let updatedUser = targetUser;
    db.update((d) => {
      const idx = d.users.findIndex((u) => u.id === id);
      if (idx !== -1) {
        d.users[idx].passwordHash = newHash;
        d.users[idx].passwordUpdatedAt = nowIso;
        d.users[idx].mustChangePassword = id === currentUser.id ? verifyPassword(DEFAULT_TESTING_PASSWORD, newHash) : true;
        updatedUser = d.users[idx];
      }
      d.auditLogs.unshift({
        id: `log-pwreset-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: "Reset Password Pengguna",
        entityType: "USER",
        entityId: id,
        details: `System Administrator mereset password untuk akun ${targetUser.name} (@${targetUser.username || deriveDefaultUsername(targetUser.email, targetUser.name)} \xB7 ${targetUser.roleTitle}).`,
        timestamp: nowIso
      });
    });
    await db.syncUserImmediately(updatedUser);
    revokeAllSessionsForUser(id);
    if (id === currentUser.id) {
      res.setHeader("X-Refreshed-Token", createSessionToken(updatedUser));
    }
    res.json({
      message: `Password untuk akun "${targetUser.name}" berhasil direset dan dienkripsi.`,
      user: sanitizeUser(updatedUser)
    });
  });
  app.delete("/api/users/:id", async (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.isActive === false) {
      return res.status(403).json({ error: "Akun Anda sedang nonaktif." });
    }
    if (currentUser.role !== "admin" && !currentUser.permissions?.canManageUsers) {
      return res.status(403).json({ error: "Hanya Admin yang memiliki hak menghapus akun pengguna" });
    }
    const { id } = req.params;
    if (id === currentUser.id) {
      return res.status(400).json({ error: "Tidak dapat menghapus akun yang sedang Anda gunakan." });
    }
    const currentData = db.getData();
    const targetUser = currentData.users.find((u) => u.id === id);
    if (!targetUser) {
      return res.status(404).json({ error: "Pengguna tidak ditemukan." });
    }
    const raciRefs = Object.values(currentData.outputRaciRecords || {}).filter(
      (r) => r.responsibleUserId === id || r.accountableUserId === id || r.accountableFinanceUserId === id || (r.consultedUsers || []).includes(targetUser.name) || (r.informedUsers || []).includes(targetUser.name)
    );
    const monitoringActRefs = Object.values(currentData.activityMonitoringRecords || {}).filter(
      (m) => m.updatedById === id || (m.tools || []).some((t) => t.assignedById === id)
    );
    const torRefs = (currentData.tors || []).filter(
      (t) => t.createdById === id || t.picId === id || t.picName === targetUser.name
    );
    const caRefs = (currentData.cashAdvances || []).filter((c) => c.requesterId === id);
    if (raciRefs.length > 0 || monitoringActRefs.length > 0 || torRefs.length > 0 || caRefs.length > 0) {
      return res.status(400).json({
        error: `Akun "${targetUser.name}" memiliki riwayat data aktif/historis (${raciRefs.length} RACI Output, ${monitoringActRefs.length} Monitoring Activity, ${torRefs.length} ToR, ${caRefs.length} Cash Advance). Demi menjaga keutuhan riwayat monitoring dan audit trail, gunakan fitur "Nonaktifkan" (jangan dihapus permanen).`
      });
    }
    db.update((d) => {
      d.users = d.users.filter((u) => u.id !== id);
      d.auditLogs.unshift({
        id: `log-del-user-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: "Penghapusan Akun Pengguna",
        entityType: "USER",
        entityId: id,
        details: `Menghapus akun pengguna yang belum memiliki riwayat penugasan: ${targetUser.name} (${targetUser.email})`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    });
    await db.removeUserImmediately(id);
    revokeAllSessionsForUser(id);
    res.json({
      message: `Akun pengguna ${targetUser.name} berhasil dihapus.`,
      id
    });
  });
  app.get("/api/programs", (req, res) => {
    const data = db.getData();
    res.json({
      programs: data.programs || [],
      outcomes: data.outcomes,
      outputs: data.outputs,
      activities: data.activities,
      subActivities: data.subActivities
    });
  });
  app.post("/api/programs", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (!currentUser.permissions?.canManagePrograms && currentUser.role !== "director" && currentUser.role !== "program_manager") {
      return res.status(403).json({ error: "Tidak memiliki kewenangan membuat Program baru" });
    }
    const { name, location, startDate, endDate, description, folderUrl, picId, status } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Nama Program / Judul Program wajib diisi" });
    }
    if (!location || !location.trim()) {
      return res.status(400).json({ error: "Lokasi Program wajib diisi" });
    }
    if (!startDate) {
      return res.status(400).json({ error: "Tanggal Mulai program wajib diisi" });
    }
    if (!endDate) {
      return res.status(400).json({ error: "Tanggal Selesai program wajib diisi" });
    }
    if (new Date(endDate) < new Date(startDate)) {
      return res.status(400).json({ error: "Tanggal selesai tidak boleh lebih awal dari tanggal mulai" });
    }
    const data = db.getData();
    const picUser = picId ? data.users.find((u) => u.id === picId) : currentUser;
    const newProgram = {
      id: `prog-${Date.now()}`,
      name: name.trim(),
      location: location.trim(),
      startDate,
      endDate,
      description: description ? description.trim() : "",
      folderUrl: folderUrl ? String(folderUrl).trim() : "",
      picId: picUser ? picUser.id : currentUser.id,
      picName: picUser ? picUser.name : currentUser.name,
      status: status || "Aktif",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    db.update((d) => {
      if (!d.programs) d.programs = [];
      d.programs.unshift(newProgram);
      d.auditLogs.unshift({
        id: `log-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: "Pembuatan Program",
        entityType: "PROGRAM",
        entityId: newProgram.id,
        details: `Membuat Program baru: ${newProgram.name} di ${newProgram.location}`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    });
    res.status(201).json(newProgram);
  });
  app.put("/api/programs/:id", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (!currentUser.permissions?.canManagePrograms && currentUser.role !== "director" && currentUser.role !== "program_manager") {
      return res.status(403).json({ error: "Tidak memiliki kewenangan mengubah Program" });
    }
    const { id } = req.params;
    const { name, location, startDate, endDate, description, folderUrl, picId, status } = req.body;
    if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
      return res.status(400).json({ error: "Tanggal selesai tidak boleh lebih awal dari tanggal mulai" });
    }
    const data = db.getData();
    const picUser = picId ? data.users.find((u) => u.id === picId) : null;
    let updated = null;
    db.update((d) => {
      if (!d.programs) d.programs = [];
      const idx = d.programs.findIndex((p) => p.id === id);
      if (idx !== -1) {
        d.programs[idx] = {
          ...d.programs[idx],
          name: name ? name.trim() : d.programs[idx].name,
          location: location ? location.trim() : d.programs[idx].location,
          startDate: startDate ?? d.programs[idx].startDate,
          endDate: endDate ?? d.programs[idx].endDate,
          description: description !== void 0 ? description.trim() : d.programs[idx].description,
          folderUrl: folderUrl !== void 0 ? String(folderUrl).trim() : d.programs[idx].folderUrl,
          picId: picUser ? picUser.id : d.programs[idx].picId,
          picName: picUser ? picUser.name : d.programs[idx].picName,
          status: status ?? d.programs[idx].status,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        updated = d.programs[idx];
        if (name && name.trim()) {
          d.outcomes.forEach((o) => {
            if (o.programId === id) {
              o.programName = name.trim();
              o.projectName = name.trim();
            }
          });
          d.tors.forEach((t) => {
            if (t.programId === id) {
              t.programName = name.trim();
            }
          });
        }
        d.auditLogs.unshift({
          id: `log-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: "Pembaruan Program",
          entityType: "PROGRAM",
          entityId: id,
          details: `Memperbarui informasi Program: ${updated.name}`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    });
    if (!updated) return res.status(404).json({ error: "Program tidak ditemukan" });
    res.json(updated);
  });
  app.delete("/api/programs/:id", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (!currentUser.permissions?.canManagePrograms && currentUser.role !== "director" && currentUser.role !== "program_manager" && currentUser.role !== "finance" && currentUser.role !== "hr" && currentUser.role !== "admin") {
      return res.status(403).json({ error: "Tidak memiliki kewenangan menghapus Program" });
    }
    const { id } = req.params;
    const data = db.getData();
    const targetProgram = (data.programs || []).find((p) => p.id === id);
    if (!targetProgram) {
      return res.status(404).json({ error: "Program tidak ditemukan" });
    }
    if (targetProgram.status !== "Selesai") {
      return res.status(400).json({
        error: "Hanya Program yang sudah berstatus Selesai yang dapat dihapus."
      });
    }
    let deletedName = "";
    db.update((d) => {
      if (!d.programs) d.programs = [];
      const idx = d.programs.findIndex((p) => p.id === id);
      if (idx !== -1) {
        deletedName = d.programs[idx].name;
        d.programs.splice(idx, 1);
        const outcomeIds = new Set(
          (d.outcomes || []).filter((o) => o.programId === id).map((o) => o.id)
        );
        const outputIds = new Set(
          (d.outputs || []).filter((op) => outcomeIds.has(op.outcomeId)).map((op) => op.id)
        );
        const activityIds = new Set(
          (d.activities || []).filter((act) => outputIds.has(act.outputId)).map((act) => act.id)
        );
        if (d.subActivities) {
          d.subActivities = d.subActivities.filter((sa) => !activityIds.has(sa.activityId));
        }
        if (d.activities) {
          d.activities = d.activities.filter((act) => !outputIds.has(act.outputId));
        }
        if (d.outputs) {
          d.outputs = d.outputs.filter((op) => !outcomeIds.has(op.outcomeId));
        }
        if (d.outcomes) {
          d.outcomes = d.outcomes.filter((o) => o.programId !== id);
        }
        d.auditLogs.unshift({
          id: `log-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: "Penghapusan Program",
          entityType: "PROGRAM",
          entityId: id,
          details: `Menghapus Program Selesai: ${deletedName}`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    });
    res.json({ message: "Program berhasil dihapus" });
  });
  app.post("/api/outcomes", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== "director" && currentUser.role !== "program_manager" && currentUser.role !== "finance" && currentUser.role !== "meal" && !currentUser.permissions?.canManagePrograms) {
      return res.status(403).json({ error: "Tidak memiliki kewenangan membuat Outcome" });
    }
    const { programId, outcomeNumber, name, description, picId, indicators, status } = req.body;
    const cleanNumber = String(outcomeNumber || "").trim();
    const cleanDesc = String(description || "").trim();
    const cleanName = String(name || "").trim() || (cleanNumber && cleanDesc ? `${cleanNumber}: ${cleanDesc}` : cleanDesc || cleanNumber);
    if (!cleanName) {
      return res.status(400).json({ error: "Nomor Outcome atau Description Outcome wajib diisi" });
    }
    if (!programId) {
      return res.status(400).json({ error: "Program induk wajib dipilih" });
    }
    const data = db.getData();
    const program = (data.programs || []).find((p) => p.id === programId);
    if (!program) {
      return res.status(400).json({ error: "Program induk yang dipilih tidak ditemukan" });
    }
    const picUser = data.users.find((u) => u.id === picId) || currentUser;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const existingProgOutcomeCount = (data.outcomes || []).filter(
      (o) => o.programId === program.id
    ).length;
    const resolvedOutcomeNumber = cleanNumber || cleanName.match(/^(Outcome\s*[\d.]+)/i)?.[1]?.replace(/\s+/g, " ").trim() || `Outcome ${existingProgOutcomeCount + 1}`;
    const resolvedCode = typeof req.body?.code === "string" && req.body.code.trim() || resolvedOutcomeNumber;
    const newOutcome = {
      id: `out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      programId: program.id,
      programName: program.name,
      outcomeNumber: resolvedOutcomeNumber,
      code: resolvedCode,
      name: cleanName,
      description: cleanDesc || cleanName,
      picId: picUser.id,
      picName: picUser.name,
      projectName: program.name,
      status: status || "Belum Dimulai",
      indicators: Array.isArray(indicators) ? indicators : [],
      createdAt: nowIso,
      updatedAt: nowIso
    };
    db.update((d) => {
      d.outcomes.push(newOutcome);
      d.auditLogs.unshift({
        id: `log-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: "Pembuatan Outcome",
        entityType: "PROGRAM",
        entityId: newOutcome.id,
        details: `Membuat Outcome baru: ${newOutcome.name} di bawah Program: ${program.name}`,
        timestamp: nowIso
      });
    });
    res.status(201).json(newOutcome);
  });
  app.put("/api/outcomes/:id", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== "director" && currentUser.role !== "program_manager" && currentUser.role !== "finance" && currentUser.role !== "meal" && !currentUser.permissions?.canManagePrograms) {
      return res.status(403).json({ error: "Tidak memiliki kewenangan mengubah Outcome" });
    }
    const { id } = req.params;
    const { outcomeNumber, code, name, description, picId, projectName, indicators, status } = req.body;
    const data = db.getData();
    const existingOutcome = (data.outcomes || []).find((o) => o.id === id);
    if (!existingOutcome) {
      return res.status(404).json({ error: "Outcome tidak ditemukan" });
    }
    const parentProgram = (data.programs || []).find((p) => p.id === existingOutcome.programId);
    if (!parentProgram) {
      return res.status(400).json({ error: "Program induk dari Outcome ini tidak ditemukan" });
    }
    const picUser = picId ? data.users.find((u) => u.id === picId) : null;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    let updated = null;
    db.update((d) => {
      const idx = d.outcomes.findIndex((o) => o.id === id);
      if (idx !== -1) {
        const nextNum = outcomeNumber !== void 0 ? String(outcomeNumber).trim() : d.outcomes[idx].outcomeNumber;
        const nextDesc = description !== void 0 ? String(description).trim() : d.outcomes[idx].description;
        const nextName = name !== void 0 && String(name).trim() ? String(name).trim() : nextNum && nextDesc ? `${nextNum}: ${nextDesc}` : d.outcomes[idx].name;
        const nextCode = typeof code === "string" && code.trim() || nextNum || d.outcomes[idx].code || void 0;
        d.outcomes[idx] = {
          ...d.outcomes[idx],
          programId: parentProgram.id,
          outcomeNumber: nextNum || void 0,
          code: nextCode,
          name: nextName,
          description: nextDesc ?? d.outcomes[idx].description,
          picId: picUser ? picUser.id : d.outcomes[idx].picId,
          picName: picUser ? picUser.name : d.outcomes[idx].picName,
          projectName: projectName ?? d.outcomes[idx].projectName ?? parentProgram.name,
          indicators: indicators ?? d.outcomes[idx].indicators,
          status: status ?? d.outcomes[idx].status,
          updatedAt: nowIso
        };
        updated = d.outcomes[idx];
        d.auditLogs.unshift({
          id: `log-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: "Perubahan Outcome",
          entityType: "PROGRAM",
          entityId: id,
          details: `Memperbarui Outcome: ${nextName}`,
          timestamp: nowIso
        });
      }
    });
    if (!updated) return res.status(404).json({ error: "Outcome tidak ditemukan" });
    res.json(updated);
  });
  app.delete("/api/outcomes/:id", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== "director" && currentUser.role !== "program_manager" && currentUser.role !== "finance" && currentUser.role !== "meal" && !currentUser.permissions?.canManagePrograms) {
      return res.status(403).json({ error: "Tidak memiliki kewenangan menghapus Outcome" });
    }
    const { id } = req.params;
    const data = db.getData();
    const hasOutputs = data.outputs.some((o) => o.outcomeId === id);
    if (hasOutputs) {
      return res.status(400).json({
        error: "Tidak dapat menghapus Outcome ini karena masih memiliki Output terhubung. Hapus atau pindahkan Output terlebih dahulu."
      });
    }
    db.update((d) => {
      d.outcomes = d.outcomes.filter((o) => o.id !== id);
      d.auditLogs.unshift({
        id: `log-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: "Penghapusan Outcome",
        entityType: "PROGRAM",
        entityId: id,
        details: `Menghapus Outcome ID: ${id}`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    });
    res.json({ message: "Outcome berhasil dihapus" });
  });
  app.post("/api/outputs", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== "director" && currentUser.role !== "program_manager" && currentUser.role !== "finance" && currentUser.role !== "meal" && !currentUser.permissions?.canManagePrograms) {
      return res.status(403).json({ error: "Tidak memiliki kewenangan membuat Output" });
    }
    const { outcomeId, outputNumber, code, name, description, picId, indicators, status } = req.body;
    const cleanNumber = String(outputNumber || "").trim();
    const cleanDesc = String(description || "").trim();
    const cleanName = String(name || "").trim() || (cleanNumber && cleanDesc ? `${cleanNumber}: ${cleanDesc}` : cleanDesc || cleanNumber);
    if (!outcomeId || !cleanName) {
      return res.status(400).json({ error: "Outcome dan Nomor/Deskripsi Output wajib diisi" });
    }
    const data = db.getData();
    const parentOutcome = data.outcomes.find((o) => o.id === outcomeId);
    if (!parentOutcome) {
      return res.status(400).json({ error: "Outcome induk yang dipilih tidak ditemukan" });
    }
    if (!parentOutcome.programId) {
      return res.status(400).json({ error: "Outcome induk belum terhubung ke Program yang valid" });
    }
    const picUser = data.users.find((u) => u.id === picId) || currentUser;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const siblingCount = (data.outputs || []).filter((o) => o.outcomeId === outcomeId).length;
    const ocDigits = parentOutcome.outcomeNumber?.match(/\d+/)?.[0] || "1";
    const resolvedOutputNumber = cleanNumber || cleanName.match(/^(Output\s*[\d.]+)/i)?.[1]?.replace(/\s+/g, " ").trim() || `Output ${ocDigits}.${siblingCount + 1}`;
    const resolvedCode = typeof code === "string" && code.trim() || resolvedOutputNumber;
    const newOutput = {
      id: `outp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      programId: parentOutcome.programId,
      outcomeId: parentOutcome.id,
      outputNumber: resolvedOutputNumber,
      code: resolvedCode,
      name: cleanName,
      description: cleanDesc || cleanName,
      picId: picUser.id,
      picName: picUser.name,
      status: status || "Belum Dimulai",
      indicators: Array.isArray(indicators) ? indicators : [],
      createdAt: nowIso,
      updatedAt: nowIso
    };
    db.update((d) => {
      d.outputs.push(newOutput);
      d.auditLogs.unshift({
        id: `log-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: "Pembuatan Output",
        entityType: "PROGRAM",
        entityId: newOutput.id,
        details: `Membuat Output baru: ${newOutput.name} di bawah Outcome: ${parentOutcome.name}`,
        timestamp: nowIso
      });
    });
    res.status(201).json(newOutput);
  });
  app.put("/api/outputs/:id", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== "director" && currentUser.role !== "program_manager" && currentUser.role !== "finance" && currentUser.role !== "meal" && !currentUser.permissions?.canManagePrograms) {
      return res.status(403).json({ error: "Tidak memiliki kewenangan mengubah Output" });
    }
    const { id } = req.params;
    const { outputNumber, code, name, description, picId, indicators, status, outcomeId } = req.body;
    const data = db.getData();
    const existingOutput = data.outputs.find((o) => o.id === id);
    if (!existingOutput) {
      return res.status(404).json({ error: "Output tidak ditemukan" });
    }
    const targetOutcomeId = outcomeId ?? existingOutput.outcomeId;
    const parentOutcome = data.outcomes.find((o) => o.id === targetOutcomeId);
    if (!parentOutcome) {
      return res.status(400).json({ error: "Outcome induk dari Output ini tidak ditemukan" });
    }
    const picUser = picId ? data.users.find((u) => u.id === picId) : null;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    let updated = null;
    db.update((d) => {
      const idx = d.outputs.findIndex((o) => o.id === id);
      if (idx !== -1) {
        const nextNum = outputNumber !== void 0 ? String(outputNumber).trim() : d.outputs[idx].outputNumber;
        const nextDesc = description !== void 0 ? String(description).trim() : d.outputs[idx].description;
        const nextName = name !== void 0 && String(name).trim() ? String(name).trim() : nextNum && nextDesc ? `${nextNum}: ${nextDesc}` : d.outputs[idx].name;
        const nextCode = typeof code === "string" && code.trim() || nextNum || d.outputs[idx].code || void 0;
        d.outputs[idx] = {
          ...d.outputs[idx],
          programId: parentOutcome.programId,
          outcomeId: parentOutcome.id,
          outputNumber: nextNum || void 0,
          code: nextCode,
          name: nextName,
          description: nextDesc ?? d.outputs[idx].description,
          picId: picUser ? picUser.id : d.outputs[idx].picId,
          picName: picUser ? picUser.name : d.outputs[idx].picName,
          indicators: indicators ?? d.outputs[idx].indicators,
          status: status ?? d.outputs[idx].status,
          updatedAt: nowIso
        };
        updated = d.outputs[idx];
        d.auditLogs.unshift({
          id: `log-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: "Perubahan Output",
          entityType: "PROGRAM",
          entityId: id,
          details: `Memperbarui Output: ${nextName}`,
          timestamp: nowIso
        });
      }
    });
    if (!updated) return res.status(404).json({ error: "Output tidak ditemukan" });
    res.json(updated);
  });
  app.delete("/api/outputs/:id", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== "director" && currentUser.role !== "program_manager" && currentUser.role !== "finance" && currentUser.role !== "meal" && !currentUser.permissions?.canManagePrograms) {
      return res.status(403).json({ error: "Tidak memiliki kewenangan menghapus Output" });
    }
    const { id } = req.params;
    const data = db.getData();
    const hasActivities = data.activities.some((a) => a.outputId === id);
    if (hasActivities) {
      return res.status(400).json({
        error: "Tidak dapat menghapus Output ini karena masih memiliki Activity terhubung."
      });
    }
    db.update((d) => {
      d.outputs = d.outputs.filter((o) => o.id !== id);
      d.auditLogs.unshift({
        id: `log-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: "Penghapusan Output",
        entityType: "PROGRAM",
        entityId: id,
        details: `Menghapus Output ID: ${id}`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    });
    res.json({ message: "Output berhasil dihapus" });
  });
  app.post("/api/activities", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== "director" && currentUser.role !== "program_manager" && currentUser.role !== "finance" && currentUser.role !== "meal" && !currentUser.permissions?.canManagePrograms) {
      return res.status(403).json({ error: "Tidak memiliki kewenangan membuat Activity" });
    }
    const {
      outputId,
      activityNumber,
      name,
      code,
      description,
      anticipatedInputs,
      plannedParticipantsBreakdown,
      picId,
      startDate,
      endDate,
      status
    } = req.body;
    if (!outputId || !name) {
      return res.status(400).json({ error: "Output dan Nama Activity wajib diisi" });
    }
    const data = db.getData();
    const parentOutput = data.outputs.find((o) => o.id === outputId);
    if (!parentOutput) {
      return res.status(400).json({ error: "Output induk yang dipilih tidak ditemukan" });
    }
    const parentOutcome = data.outcomes.find((oc) => oc.id === parentOutput.outcomeId);
    const resolvedProgramId = parentOutput.programId || parentOutcome?.programId || "";
    if (!resolvedProgramId || !parentOutput.outcomeId) {
      return res.status(400).json({
        error: "Relasi Program / Outcome induk pada Output ini belum lengkap"
      });
    }
    const picUser = data.users.find((u) => u.id === picId) || currentUser;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const siblingActCount = (data.activities || []).filter((a) => a.outputId === outputId).length;
    const opDigits = parentOutput.outputNumber?.match(/[\d.]+/)?.[0] || "1.1";
    const resolvedActNumber = typeof activityNumber === "string" && activityNumber.trim() || String(name).match(/^(Activity\s*[\d.]+)/i)?.[1]?.replace(/\s+/g, " ").trim() || `Activity ${opDigits}.${siblingActCount + 1}`;
    const resolvedCode = typeof code === "string" && code.trim() || `${opDigits}.${siblingActCount + 1}`;
    const newActivity = {
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      programId: resolvedProgramId,
      outcomeId: parentOutput.outcomeId,
      outputId: parentOutput.id,
      activityNumber: resolvedActNumber,
      name: String(name).trim(),
      code: resolvedCode,
      description: description || "",
      anticipatedInputs: typeof anticipatedInputs === "string" ? anticipatedInputs.trim() : void 0,
      plannedParticipantsBreakdown: typeof plannedParticipantsBreakdown === "string" ? plannedParticipantsBreakdown.trim() : void 0,
      picId: picUser.id,
      picName: picUser.name,
      startDate: startDate || nowIso.slice(0, 10),
      endDate: endDate || nowIso.slice(0, 10),
      status: status || "Belum Dimulai",
      createdAt: nowIso,
      updatedAt: nowIso
    };
    db.update((d) => {
      d.activities.push(newActivity);
      d.auditLogs.unshift({
        id: `log-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: "Pembuatan Activity",
        entityType: "PROGRAM",
        entityId: newActivity.id,
        details: `Membuat Activity baru: ${newActivity.name} di bawah Output: ${parentOutput.name}`,
        timestamp: nowIso
      });
    });
    res.status(201).json(newActivity);
  });
  app.put("/api/activities/:id", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== "director" && currentUser.role !== "program_manager" && currentUser.role !== "finance" && currentUser.role !== "meal" && !currentUser.permissions?.canManagePrograms) {
      return res.status(403).json({ error: "Tidak memiliki kewenangan mengubah Activity" });
    }
    const { id } = req.params;
    const {
      activityNumber,
      name,
      code,
      description,
      anticipatedInputs,
      plannedParticipantsBreakdown,
      picId,
      startDate,
      endDate,
      status,
      outputId
    } = req.body;
    const data = db.getData();
    const existingAct = data.activities.find((a) => a.id === id);
    if (!existingAct) {
      return res.status(404).json({ error: "Activity tidak ditemukan" });
    }
    const targetOutputId = outputId ?? existingAct.outputId;
    const parentOutput = data.outputs.find((o) => o.id === targetOutputId);
    if (!parentOutput) {
      return res.status(400).json({ error: "Output induk dari Activity ini tidak ditemukan" });
    }
    const parentOutcome = data.outcomes.find((oc) => oc.id === parentOutput.outcomeId);
    const resolvedProgramId = parentOutput.programId || parentOutcome?.programId || existingAct.programId || "";
    const resolvedOutcomeId = parentOutput.outcomeId || existingAct.outcomeId || "";
    const picUser = picId ? data.users.find((u) => u.id === picId) : null;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    let updated = null;
    db.update((d) => {
      const idx = d.activities.findIndex((a) => a.id === id);
      if (idx !== -1) {
        const nextActNum = activityNumber !== void 0 ? typeof activityNumber === "string" && activityNumber.trim() ? activityNumber.trim() : void 0 : d.activities[idx].activityNumber;
        const nextCode = code !== void 0 ? typeof code === "string" && code.trim() ? code.trim() : void 0 : d.activities[idx].code || nextActNum;
        d.activities[idx] = {
          ...d.activities[idx],
          programId: resolvedProgramId,
          outcomeId: resolvedOutcomeId,
          outputId: parentOutput.id,
          activityNumber: nextActNum,
          name: name ?? d.activities[idx].name,
          code: nextCode,
          description: description ?? d.activities[idx].description,
          anticipatedInputs: anticipatedInputs !== void 0 ? typeof anticipatedInputs === "string" ? anticipatedInputs.trim() : "" : d.activities[idx].anticipatedInputs,
          plannedParticipantsBreakdown: plannedParticipantsBreakdown !== void 0 ? typeof plannedParticipantsBreakdown === "string" ? plannedParticipantsBreakdown.trim() : "" : d.activities[idx].plannedParticipantsBreakdown,
          picId: picUser ? picUser.id : d.activities[idx].picId,
          picName: picUser ? picUser.name : d.activities[idx].picName,
          startDate: startDate ?? d.activities[idx].startDate,
          endDate: endDate ?? d.activities[idx].endDate,
          status: status ?? d.activities[idx].status,
          updatedAt: nowIso
        };
        updated = d.activities[idx];
        if (nextCode) {
          d.tors.forEach((t) => {
            if (t.activityId === id) {
              t.activityCode = nextCode;
              t.hierarchyCode = nextCode;
            }
          });
        }
        d.auditLogs.unshift({
          id: `log-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: "Perubahan Activity",
          entityType: "PROGRAM",
          entityId: id,
          details: `Memperbarui Activity: ${d.activities[idx].name}`,
          timestamp: nowIso
        });
      }
    });
    if (!updated) return res.status(404).json({ error: "Activity tidak ditemukan" });
    res.json(updated);
  });
  app.delete("/api/activities/:id", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== "director" && currentUser.role !== "program_manager" && currentUser.role !== "finance" && currentUser.role !== "meal" && !currentUser.permissions?.canManagePrograms) {
      return res.status(403).json({ error: "Tidak memiliki kewenangan menghapus Activity" });
    }
    const { id } = req.params;
    const data = db.getData();
    const hasTors = data.tors.some((t) => t.activityId === id);
    if (hasTors) {
      return res.status(400).json({
        error: "Tidak dapat menghapus Activity ini karena masih memiliki TOR terhubung."
      });
    }
    db.update((d) => {
      d.activities = d.activities.filter((a) => a.id !== id);
      d.subActivities = d.subActivities.filter((s) => s.activityId !== id);
      d.auditLogs.unshift({
        id: `log-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: "Penghapusan Activity",
        entityType: "PROGRAM",
        entityId: id,
        details: `Menghapus Activity ID: ${id}`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    });
    res.json({ message: "Activity berhasil dihapus" });
  });
  app.post("/api/sub-activities", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== "director" && currentUser.role !== "program_manager" && currentUser.role !== "finance" && currentUser.role !== "meal" && !currentUser.permissions?.canManagePrograms) {
      return res.status(403).json({ error: "Tidak memiliki kewenangan membuat Sub-Activity" });
    }
    const { activityId, name, code, description, picName, startDate, endDate, status } = req.body;
    if (!activityId || !name) {
      return res.status(400).json({ error: "Activity ID dan Nama Sub-Activity wajib diisi" });
    }
    const data = db.getData();
    const parentAct = data.activities.find((a) => a.id === activityId);
    if (!parentAct) {
      return res.status(400).json({ error: "Activity induk yang dipilih tidak ditemukan" });
    }
    const parentOutp = data.outputs.find((o) => o.id === parentAct.outputId);
    const parentOutc = parentOutp ? data.outcomes.find((oc) => oc.id === parentOutp.outcomeId) : void 0;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const newSub = {
      id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      programId: parentAct.programId || parentOutp?.programId || parentOutc?.programId || "",
      outcomeId: parentAct.outcomeId || parentOutp?.outcomeId || "",
      outputId: parentAct.outputId || "",
      activityId: parentAct.id,
      code: typeof code === "string" && code.trim() ? code.trim() : void 0,
      name: String(name).trim(),
      description: description || "",
      picName: picName || "",
      startDate: startDate || "",
      endDate: endDate || "",
      status: status || "Belum Dimulai",
      createdAt: nowIso,
      updatedAt: nowIso
    };
    db.update((d) => {
      d.subActivities.push(newSub);
      d.auditLogs.unshift({
        id: `log-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: "Pembuatan Sub-Activity",
        entityType: "PROGRAM",
        entityId: newSub.id,
        details: `Membuat Sub-Activity baru: ${newSub.name}`,
        timestamp: nowIso
      });
    });
    res.status(201).json(newSub);
  });
  app.put("/api/sub-activities/:id", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== "director" && currentUser.role !== "program_manager" && currentUser.role !== "finance" && currentUser.role !== "meal" && !currentUser.permissions?.canManagePrograms) {
      return res.status(403).json({ error: "Tidak memiliki kewenangan mengubah Sub-Activity" });
    }
    const { id } = req.params;
    const { name, code, description, picName, startDate, endDate, status } = req.body;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    let updated = null;
    db.update((d) => {
      const idx = d.subActivities.findIndex((s) => s.id === id);
      if (idx !== -1) {
        d.subActivities[idx] = {
          ...d.subActivities[idx],
          name: name ?? d.subActivities[idx].name,
          code: code !== void 0 ? String(code).trim() || void 0 : d.subActivities[idx].code,
          description: description ?? d.subActivities[idx].description,
          picName: picName ?? d.subActivities[idx].picName,
          startDate: startDate ?? d.subActivities[idx].startDate,
          endDate: endDate ?? d.subActivities[idx].endDate,
          status: status ?? d.subActivities[idx].status,
          updatedAt: nowIso
        };
        updated = d.subActivities[idx];
      }
    });
    if (!updated) return res.status(404).json({ error: "Sub-Activity tidak ditemukan" });
    res.json(updated);
  });
  app.delete("/api/sub-activities/:id", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== "director" && currentUser.role !== "program_manager" && !currentUser.permissions?.canManagePrograms) {
      return res.status(403).json({ error: "Tidak memiliki kewenangan menghapus Sub-Activity" });
    }
    const { id } = req.params;
    db.update((d) => {
      d.subActivities = d.subActivities.filter((s) => s.id !== id);
    });
    res.json({ message: "Sub-Activity berhasil dihapus" });
  });
  app.post("/api/programs/:id/import-hierarchy", async (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== "director" && currentUser.role !== "program_manager" && currentUser.role !== "finance" && currentUser.role !== "meal" && !currentUser.permissions?.canManagePrograms) {
      return res.status(403).json({
        errorCategory: "AUTHORIZATION_ERROR",
        error: "Tidak memiliki kewenangan untuk mengimpor Hirarki Program."
      });
    }
    const programId = String(req.params.id || "").trim();
    console.log(
      `[IMPORT] IMPORT REQUEST RECEIVED (programId=${programId}, user=${currentUser.id}, role=${currentUser.role})`
    );
    if (!programId) {
      return res.status(400).json({
        errorCategory: "VALIDATION_ERROR",
        error: "[VALIDATION ERROR] ID Program induk wajib disertakan."
      });
    }
    const { fileName, buffer } = await extractExcelUploadFromRequest(req);
    const lowerFileName = fileName.toLowerCase();
    if (!/\.(xlsx|xls|csv)$/.test(lowerFileName)) {
      console.warn(`[IMPORT] UPLOAD REJECTED (invalid format: ${fileName})`);
      return res.status(400).json({
        errorCategory: "UPLOAD_ERROR",
        error: `[UPLOAD ERROR] Format file "${fileName}" tidak didukung. Gunakan file .xlsx, .xls, atau .csv.`
      });
    }
    const currentData = db.getData();
    const targetProgram = (currentData.programs || []).find((p) => p.id === programId);
    if (!targetProgram) {
      return res.status(404).json({
        errorCategory: "VALIDATION_ERROR",
        error: "[VALIDATION ERROR] Program induk yang dipilih tidak ditemukan di database."
      });
    }
    let parsedResult;
    try {
      parsedResult = parseProgramHierarchyWorkbookBuffer({
        buffer,
        program: targetProgram,
        existingOutcomes: currentData.outcomes || [],
        existingOutputs: currentData.outputs || [],
        existingActivities: currentData.activities || [],
        existingSubActivities: currentData.subActivities || []
      });
    } catch (parseErr) {
      console.error(
        `[IMPORT] EXCEL PARSING FAILED (file="${fileName}"): ${parseErr?.message || parseErr}`
      );
      return res.status(400).json({
        errorCategory: "EXCEL_PARSING_ERROR",
        error: `[EXCEL PARSING ERROR] File "${fileName}" gagal dibaca: ${parseErr?.message || "Format workbook Excel rusak atau tidak valid."}`
      });
    }
    console.log(
      `[IMPORT] FILE PARSED (file="${fileName}", sheet="${parsedResult.sheetName}", sheets=${parsedResult.sheetCount})`
    );
    console.log(`[IMPORT] ROWS DETECTED: ${parsedResult.rows.length}`);
    if (!parsedResult.headerMatched && parsedResult.rawRowCount > 0) {
      return res.status(400).json({
        errorCategory: "VALIDATION_ERROR",
        error: `[VALIDATION ERROR] Kolom wajib Hirarki Program (Outcome / Nomor outcome, Output, Activity) tidak ditemukan pada file "${fileName}".`
      });
    }
    if (parsedResult.rows.length === 0) {
      return res.status(400).json({
        errorCategory: "VALIDATION_ERROR",
        error: `[VALIDATION ERROR] File Excel "${fileName}" kosong atau tidak memiliki baris data Hirarki Program yang dapat diimpor.`
      });
    }
    const invalidRows = parsedResult.rows.filter((r) => r.status === "invalid");
    if (invalidRows.length > 0) {
      const rowErrorPreview = invalidRows.slice(0, 5).map((r) => `Baris ${r.rowNumber}: ${r.statusMessage}`).join("; ");
      console.warn(
        `[IMPORT] VALIDATION FAILED (invalidRows=${invalidRows.length}): ${rowErrorPreview}`
      );
      return res.status(400).json({
        errorCategory: "VALIDATION_ERROR",
        error: `[VALIDATION ERROR] Ditemukan ${invalidRows.length} baris tidak valid pada file "${fileName}" (${rowErrorPreview}). Perbaiki baris tersebut terlebih dahulu \u2014 tidak ada data yang disimpan.`,
        rowErrors: invalidRows.map((r) => ({
          rowNumber: r.rowNumber,
          message: r.statusMessage
        }))
      });
    }
    const validRows = parsedResult.rows.filter((r) => r.status === "valid");
    const duplicateRows = parsedResult.rows.filter((r) => r.status === "duplicate");
    console.log(
      `[IMPORT] VALIDATION PASSED (validRows=${validRows.length}, duplicateRows=${duplicateRows.length})`
    );
    if (validRows.length === 0) {
      return res.json({
        alreadyUpToDate: true,
        message: `Seluruh ${duplicateRows.length} baris pada file "${fileName}" sudah terdaftar di Hirarki Program "${targetProgram.name}".`,
        summary: {
          detectedRows: parsedResult.rows.length,
          importedRows: 0,
          duplicateRows: duplicateRows.length,
          createdOutcomes: 0,
          createdOutputs: 0,
          createdActivities: 0,
          createdSubActivities: 0
        },
        expandedOutcomeIds: [],
        expandedOutputIds: []
      });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const plan = buildHierarchyImportPlan({
      validRows,
      program: targetProgram,
      existingOutcomes: currentData.outcomes || [],
      existingOutputs: currentData.outputs || [],
      existingActivities: currentData.activities || [],
      existingSubActivities: currentData.subActivities || [],
      nowIso
    });
    const summaryParts = [];
    if (plan.createdOutcomesCount > 0) summaryParts.push(`${plan.createdOutcomesCount} Outcome`);
    if (plan.addedOutcomeIndicatorsCount > 0) {
      summaryParts.push(`${plan.addedOutcomeIndicatorsCount} Indikator Outcome`);
    }
    if (plan.createdOutputsCount > 0) summaryParts.push(`${plan.createdOutputsCount} Output`);
    if (plan.addedOutputIndicatorsCount > 0) {
      summaryParts.push(`${plan.addedOutputIndicatorsCount} Indikator Output`);
    }
    if (plan.createdActivitiesCount > 0) {
      summaryParts.push(`${plan.createdActivitiesCount} Activity`);
    }
    if (plan.createdSubActivitiesCount > 0) {
      summaryParts.push(`${plan.createdSubActivitiesCount} Sub-Activity`);
    }
    const auditLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      actorId: currentUser.id,
      actorName: currentUser.name,
      actorRole: currentUser.roleTitle,
      action: "Import Excel Hirarki Program",
      entityType: "PROGRAM",
      entityId: targetProgram.id,
      details: `Mengimpor Hirarki Program dari file "${fileName}" ke Program "${targetProgram.name}": ${summaryParts.join(", ") || "Pembaruan hirarki"}`,
      timestamp: nowIso
    };
    const freshData = await db.executeHierarchyImportTransaction({
      programId: targetProgram.id,
      outcomesToUpsert: plan.outcomesToUpsert,
      outputsToUpsert: plan.outputsToUpsert,
      activitiesToUpsert: plan.activitiesToUpsert,
      subActivitiesToUpsert: plan.subActivitiesToUpsert,
      auditLog
    });
    const progOutcomeIds = new Set(
      (freshData.outcomes || []).filter((o) => o.programId === targetProgram.id).map((o) => o.id)
    );
    const progOutputIds = new Set(
      (freshData.outputs || []).filter((o) => progOutcomeIds.has(o.outcomeId)).map((o) => o.id)
    );
    const progActivityIds = new Set(
      (freshData.activities || []).filter((a) => progOutputIds.has(a.outputId)).map((a) => a.id)
    );
    res.status(200).json({
      alreadyUpToDate: false,
      message: `Hirarki Program berhasil diimpor dan tersimpan ke database dari file "${fileName}": ${summaryParts.join(", ") || "Hirarki diperbarui"}.`,
      summary: {
        detectedRows: parsedResult.rows.length,
        importedRows: validRows.length,
        duplicateRows: duplicateRows.length,
        createdOutcomes: plan.createdOutcomesCount,
        updatedOutcomes: plan.updatedOutcomesCount,
        addedOutcomeIndicators: plan.addedOutcomeIndicatorsCount,
        createdOutputs: plan.createdOutputsCount,
        updatedOutputs: plan.updatedOutputsCount,
        addedOutputIndicators: plan.addedOutputIndicatorsCount,
        createdActivities: plan.createdActivitiesCount,
        updatedActivities: plan.updatedActivitiesCount,
        createdSubActivities: plan.createdSubActivitiesCount
      },
      expandedOutcomeIds: plan.expandedOutcomeIds,
      expandedOutputIds: plan.expandedOutputIds,
      outcomes: (freshData.outcomes || []).filter((o) => progOutcomeIds.has(o.id)),
      outputs: (freshData.outputs || []).filter((o) => progOutputIds.has(o.id)),
      activities: (freshData.activities || []).filter((a) => progActivityIds.has(a.id)),
      subActivities: (freshData.subActivities || []).filter(
        (s) => progActivityIds.has(s.activityId)
      )
    });
  });
  app.get("/api/tors", (req, res) => {
    const currentUser = getCurrentUser(req);
    const data = db.getData();
    let tors = data.tors.map((t) => ({
      ...t,
      budgetRequested: getConnectedBudgetRequested(t, data.cashAdvances)
    }));
    if (currentUser.role === "staff" && !currentUser.permissions?.canViewAllTors) {
      tors = tors.filter((t) => t.picId === currentUser.id || t.createdById === currentUser.id);
    }
    const { search, picId, status, activityStatus } = req.query;
    if (search && typeof search === "string") {
      const q = search.toLowerCase();
      tors = tors.filter(
        (t) => t.title.toLowerCase().includes(q) || t.torNumber.toLowerCase().includes(q) || t.activityName.toLowerCase().includes(q) || t.picName.toLowerCase().includes(q)
      );
    }
    if (picId && typeof picId === "string") {
      tors = tors.filter((t) => t.picId === picId);
    }
    if (status && typeof status === "string") {
      tors = tors.filter((t) => t.submissionStatus === status);
    }
    if (activityStatus && typeof activityStatus === "string") {
      tors = tors.filter((t) => t.activityStatus === activityStatus);
    }
    tors.sort((a, b) => {
      const score = (t) => {
        if (t.activityStatus === "Sedang Berjalan") return 1;
        if (t.submissionStatus.includes("Menunggu Persetujuan")) return 2;
        if (t.activityStatus === "Belum Dimulai") return 3;
        if (t.activityStatus === "Selesai") return 4;
        return 5;
      };
      return score(a) - score(b);
    });
    res.json(tors);
  });
  app.get("/api/tors/preview-number", (req, res) => {
    const { programId, outcomeId, outputId, activityId, date } = req.query;
    const data = db.getData();
    const program = programId ? (data.programs || []).find((p) => p.id === programId) : null;
    const programName = program?.name || "";
    const d = date ? new Date(date) : /* @__PURE__ */ new Date();
    const validDate = isNaN(d.getTime()) ? /* @__PURE__ */ new Date() : d;
    const year = validDate.getFullYear();
    const nextSeq = getNextTorSequenceForYear(data, year);
    const preview = getTorDraftPreview({
      programName,
      explicitProgramCode: program?.code,
      programId,
      outcomeId,
      outputId,
      activityId,
      outcomes: data.outcomes,
      outputs: data.outputs,
      activities: data.activities,
      sequence: nextSeq,
      date: validDate
    });
    res.json({
      ...preview,
      nextSequenceNumber: nextSeq
    });
  });
  app.get("/api/tors/:id", (req, res) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const data = db.getData();
    const foundTor = data.tors.find((t) => t.id === id);
    if (!foundTor) {
      return res.status(404).json({ error: "TOR tidak ditemukan" });
    }
    if (!canUserAccessTorRecord(currentUser, foundTor, data)) {
      return res.status(403).json({
        error: "Akses ditolak: Anda tidak memiliki hak akses untuk melihat dokumen TOR ini."
      });
    }
    const tor = {
      ...foundTor,
      budgetRequested: getConnectedBudgetRequested(foundTor, data.cashAdvances)
    };
    const records = data.approvalRecords.filter((r) => r.torId === id);
    res.json({ tor, approvalRecords: records });
  });
  app.post("/api/tors", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (!currentUser.permissions?.canCreateTor && currentUser.role === "admin") {
      return res.status(403).json({ error: "Admin tidak berwenang membuat TOR" });
    }
    const {
      title,
      outcomeId,
      outputId,
      activityId,
      picId,
      implementingTeam,
      background,
      rationale,
      generalObjective,
      objectives,
      participantType,
      participantsType,
      participantsTarget,
      participantsCount,
      participantsCriteria,
      participantTableMode,
      participantRows,
      participantCustomColumns,
      goals,
      indicators,
      rolesResponsibilities,
      rolesNotes,
      rolesAdditionalNotes,
      mealItems,
      rundown,
      rundownNotes,
      rundownAdditionalNotes,
      challengesMitigations,
      challengesNotes,
      challengesAdditionalNotes,
      activityDescription,
      expectedResults,
      location,
      startDate,
      endDate,
      reportingPeriodType,
      reportingFrequency,
      reportingDeadline,
      additionalNotes,
      submitImmediately
    } = req.body;
    if (!title || !outcomeId || !outputId || !activityId || !picId) {
      return res.status(400).json({ error: "Judul, Outcome, Output, Activity, dan PIC wajib diisi" });
    }
    const data = db.getData();
    const outcome = data.outcomes.find((o) => o.id === outcomeId);
    const output = data.outputs.find((o) => o.id === outputId);
    const activity = data.activities.find((a) => a.id === activityId);
    const picUser = data.users.find((u) => u.id === picId);
    if (!outcome || !output || !activity || !picUser) {
      return res.status(400).json({ error: "Relasi Program atau PIC tidak valid" });
    }
    const outputRaci = data.outputRaciRecords?.[outputId];
    if (!outputRaci || outputRaci.status !== "Aktif") {
      return res.status(403).json({
        error: outputRaci?.status === "Menunggu Persetujuan Direktur" ? `Penugasan RACI pada Output "${output.name}" masih menunggu persetujuan Direktur. Pembuatan ToR belum diizinkan.` : `Penugasan RACI pada Output "${output.name}" belum ditentukan dan disetujui Direktur.`
      });
    }
    const isR = outputRaci.responsibleUserId === currentUser.id;
    const isA1 = outputRaci.accountableUserId === currentUser.id;
    const isA2 = currentUser.role === "finance" || (currentUser.roleTitle || "").toLowerCase().includes("finance");
    if (!isR && !isA1 && !isA2) {
      return res.status(403).json({
        error: `Anda tidak memiliki penugasan R (Responsible), A1 (Accountable Program), atau A2 (Accountable Finance) pada Output "${output.name}".`
      });
    }
    const creatorRaciRoleLabel = isR ? "R \u2013 Responsible" : isA1 ? "A1 \u2013 Accountable Program" : "A2 \u2013 Accountable Finance";
    const program = outcome.programId ? (data.programs || []).find((p) => p.id === outcome.programId) : null;
    const programId = req.body.programId || program?.id || outcome.programId || "";
    const programName = program?.name || outcome.programName || outcome.projectName || "";
    const programCode = generateProgramCode(programName, program?.code);
    const { hierarchyCode, isComplete: isHierarchyComplete } = computeHierarchyCode({
      programId,
      outcomeId,
      outputId,
      activityId,
      outcomes: data.outcomes,
      outputs: data.outputs,
      activities: data.activities
    });
    if (submitImmediately && (!programName || !isHierarchyComplete)) {
      return res.status(400).json({
        error: "Program, Outcome, Output, dan Activity wajib ditentukan sebelum menerbitkan nomor TOR resmi."
      });
    }
    let initialStatus = "Draft";
    if (submitImmediately) {
      initialStatus = "Menunggu Persetujuan Finance";
    }
    let torNumber;
    let isOfficialNumber = false;
    let publishedAt = void 0;
    let torSequence = void 0;
    if (submitImmediately) {
      const now = /* @__PURE__ */ new Date();
      const year = now.getFullYear();
      const nextSeq = getNextTorSequenceForYear(data, year);
      const romanMonth = getRomanMonth(now);
      torNumber = formatTorNumber({
        sequence: nextSeq,
        programCode,
        hierarchyCode,
        romanMonth,
        year
      });
      isOfficialNumber = true;
      publishedAt = now.toISOString();
      torSequence = nextSeq;
    } else {
      const romanMonth = getRomanMonth(/* @__PURE__ */ new Date());
      const year = (/* @__PURE__ */ new Date()).getFullYear();
      if (programCode && isHierarchyComplete) {
        torNumber = `DRAFT/WIJNA/${programCode}/${hierarchyCode}/${romanMonth}/${year}`;
      } else {
        torNumber = `DRAFT/WIJNA/BELUM-LENGKAP`;
      }
    }
    const newTor = {
      id: `tor-${Date.now()}`,
      torNumber,
      isOfficialNumber,
      publishedAt,
      torSequence,
      hierarchyCode,
      activityCode: hierarchyCode,
      programCode,
      title,
      programId,
      programName,
      outcomeId,
      outcomeName: outcome.name,
      outputId,
      outputName: output.name,
      activityId,
      activityName: activity.name,
      subActivityId: req.body.subActivityId || null,
      subActivityName: req.body.subActivityName || null,
      picId: picUser.id,
      picName: picUser.name,
      implementingTeam: implementingTeam || [],
      background: background || "",
      rationale: rationale || "",
      generalObjective: generalObjective || "",
      objectives: objectives || "",
      participantType: participantType || participantsType || "",
      participantsType: participantType || participantsType || "",
      participantsTarget: participantsTarget || "",
      participantsCount: participantsCount !== void 0 && participantsCount !== null && participantsCount !== "" ? Number(participantsCount) : null,
      participantsCriteria: participantsCriteria || "",
      participantTableMode: participantTableMode || "simple",
      participantRows: Array.isArray(participantRows) ? participantRows : [],
      participantCustomColumns: Array.isArray(participantCustomColumns) ? participantCustomColumns : [],
      goals: goals || [],
      indicators: indicators || [],
      rolesResponsibilities: rolesResponsibilities || [],
      rolesNotes: rolesNotes || rolesAdditionalNotes || "",
      rolesAdditionalNotes: rolesNotes || rolesAdditionalNotes || "",
      mealItems: mealItems || [],
      rundown: rundown || [],
      rundownNotes: rundownNotes || rundownAdditionalNotes || "",
      rundownAdditionalNotes: rundownNotes || rundownAdditionalNotes || "",
      challengesMitigations: challengesMitigations || [],
      challengesNotes: challengesNotes || challengesAdditionalNotes || "",
      challengesAdditionalNotes: challengesNotes || challengesAdditionalNotes || "",
      activityDescription: activityDescription || "",
      expectedResults: expectedResults || "",
      location: location || "",
      locations: req.body.locations || [],
      customPeriodId: req.body.customPeriodId || void 0,
      customPeriodCode: req.body.customPeriodCode || void 0,
      customPeriodLabel: req.body.customPeriodLabel || void 0,
      customPeriodStartDate: req.body.customPeriodStartDate || void 0,
      customPeriodEndDate: req.body.customPeriodEndDate || void 0,
      customPeriodAllocatedAmount: req.body.customPeriodAllocatedAmount !== void 0 ? Number(req.body.customPeriodAllocatedAmount) : void 0,
      startDate: startDate || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      endDate: endDate || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      reportingPeriodType: reportingPeriodType || "Sekali / Akhir Kegiatan",
      reportingFrequency: reportingFrequency || "1 kali di akhir kegiatan",
      reportingDeadline: reportingDeadline || endDate || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      additionalNotes: additionalNotes || "",
      specificObjectives: req.body.specificObjectives || [],
      timelineItems: req.body.timelineItems || [],
      monitoringItems: req.body.monitoringItems || [],
      scopeOfActivities: req.body.scopeOfActivities || [],
      implementationMechanisms: req.body.implementationMechanisms || [],
      isRundownVisible: req.body.isRundownVisible !== void 0 ? req.body.isRundownVisible : false,
      organizerPersonInCharge: req.body.organizerPersonInCharge || void 0,
      activityStatus: "Belum Dimulai",
      submissionStatus: initialStatus,
      budgetRequested: req.body.budgetRequested !== void 0 ? Number(req.body.budgetRequested) : null,
      budgetApproved: req.body.budgetApproved !== void 0 ? Number(req.body.budgetApproved) : null,
      budgetActualSpent: req.body.budgetActualSpent !== void 0 ? Number(req.body.budgetActualSpent) : null,
      budgetCurrency: req.body.budgetCurrency || "IDR",
      budgetNotes: req.body.budgetNotes || "",
      budgetApprovalStatus: req.body.budgetApprovalStatus || "Menunggu ACC Direktur",
      budgetDeterminedByFinanceName: req.body.budgetDeterminedByFinanceName || "Ratna Kusuma, S.E.",
      budgetDeterminedByFinanceAt: req.body.budgetDeterminedByFinanceAt || (/* @__PURE__ */ new Date()).toISOString(),
      budgetUpdatedByA2Name: req.body.budgetUpdatedByA2Name || void 0,
      budgetUpdatedByA2At: req.body.budgetUpdatedByA2At || void 0,
      budgetApprovedByDirectorName: req.body.budgetApprovedByDirectorName || void 0,
      budgetApprovedByDirectorAt: req.body.budgetApprovedByDirectorAt || void 0,
      budgetAuditLogs: Array.isArray(req.body.budgetAuditLogs) ? req.body.budgetAuditLogs : [
        {
          id: `bgt-log-${Date.now()}`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          actorName: req.body.budgetDeterminedByFinanceName || "Ratna Kusuma, S.E.",
          actorRole: "Finance / A2",
          actionLabel: "Penentuan Estimasi Budget Awal ToR oleh Finance",
          amount: req.body.budgetRequested !== void 0 ? Number(req.body.budgetRequested) : 0,
          status: req.body.budgetApprovalStatus || "Menunggu ACC Direktur"
        }
      ],
      createdById: currentUser.id,
      createdByName: currentUser.name,
      createdByRole: currentUser.role,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    db.update((d) => {
      d.tors.push(newTor);
      syncApprovalHubData(d);
      if (submitImmediately) {
        const nowIso = (/* @__PURE__ */ new Date()).toISOString();
        d.approvalRecords.push({
          id: `app-${Date.now()}`,
          torId: newTor.id,
          stage: "Pengajuan",
          action: "Diajukan",
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.role,
          comment: "TOR diajukan kepada A1 (Accountable Program) untuk pemeriksaan.",
          timestamp: nowIso,
          resultingStatus: initialStatus
        });
        const hubItem = d.approvalHubItems?.[`apv-tor-${newTor.id}`];
        if (hubItem) {
          hubItem.timeline = hubItem.timeline || [];
          hubItem.timeline.unshift({
            id: `tl-tor-sub-${newTor.id}-${Date.now()}`,
            timestamp: nowIso,
            actorId: currentUser.id,
            actorName: currentUser.name,
            actorRoleCode: "R",
            actorRoleTitle: currentUser.roleTitle || "PIC Kegiatan",
            responsibleName: newTor.picName,
            actionLabel: "Mengajukan Dokumen ToR ke A1 (Accountable Program)",
            resultingStatus: "Pending Verification",
            comment: "TOR diajukan kepada A1 (Accountable Program) untuk pemeriksaan.",
            version: 1
          });
          if (!d.approvalNotifications) d.approvalNotifications = [];
          d.approvalNotifications = d.approvalNotifications.filter(
            (n) => n.id !== `notif-init-${hubItem.id}` && n.approvalItemId !== hubItem.id
          );
          d.approvalNotifications.unshift({
            id: `notif-tor-init-${Date.now()}`,
            approvalItemId: hubItem.id,
            referenceNumber: newTor.torNumber,
            documentTitle: newTor.title,
            categoryCode: "tor",
            categoryLabel: "Terms of Reference (ToR)",
            eventType: "NEW_SUBMISSION",
            message: `[Terms of Reference (ToR)] "${newTor.title}" (${newTor.torNumber}) telah diajukan oleh ${currentUser.name} dan menunggu pemeriksaan A1 (${hubItem.accountableProgramUserName}).`,
            targetUserIds: [hubItem.accountableProgramUserId].filter(Boolean),
            targetRoleCodes: ["A1"],
            createdAt: nowIso,
            isReadByUserIds: []
          });
        }
      }
      d.auditLogs.unshift({
        id: `log-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: submitImmediately ? "Pembuatan & Pengajuan TOR" : "Penyimpanan Draft TOR",
        entityType: "TOR",
        entityId: newTor.id,
        details: `${newTor.torNumber}: ${newTor.title} (${initialStatus}) \u2014 Dibuat oleh ${currentUser.name} [${creatorRaciRoleLabel}] pada Output "${output.name}".`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    });
    res.status(201).json(newTor);
  });
  app.put("/api/tors/:id", (req, res) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const data = db.getData();
    const existing = data.tors.find((t) => t.id === id);
    if (!existing) {
      return res.status(404).json({ error: "TOR tidak ditemukan" });
    }
    const outputRaci = data.outputRaciRecords?.[existing.outputId];
    const isDirectorUser = currentUser.role === "director";
    const isA2OrFinanceUser = currentUser.role === "finance" || (currentUser.roleTitle || "").toLowerCase().includes("finance") || outputRaci?.accountableFinanceUserId === currentUser.id;
    const isRUser = currentUser.role !== "admin" && (outputRaci?.responsibleUserId === currentUser.id || existing.picId === currentUser.id || existing.createdById === currentUser.id);
    const isA1User = currentUser.role !== "admin" && (outputRaci?.accountableUserId === currentUser.id || !outputRaci?.accountableUserId && currentUser.role === "program_manager");
    const hasApprovedEditRequest = existing.editRequestStatus === "approved";
    const isRevisionOrDraft = existing.submissionStatus === "Draft" || existing.submissionStatus === "Perlu Perbaikan";
    if (!isDirectorUser && !isA2OrFinanceUser && !isRUser && !isA1User) {
      return res.status(403).json({
        error: "Hanya Direktur (edit langsung), A2 / Finance (update estimasi budget), serta R dan A1 pada Output ini (melalui izin Request Edit) yang berwenang memperbarui dokumen ToR."
      });
    }
    if (!isDirectorUser && !isA2OrFinanceUser && !hasApprovedEditRequest && !isRevisionOrDraft) {
      return res.status(400).json({
        error: "Dokumen bersifat final. Hanya Direktur atau A2/Finance (estimasi budget) yang dapat memperbarui langsung; R dan A1 wajib mengajukan Request Edit ke Direktur terlebih dahulu."
      });
    }
    const {
      title,
      outcomeId,
      outputId,
      activityId,
      picId,
      implementingTeam,
      background,
      rationale,
      generalObjective,
      objectives,
      goals,
      indicators,
      rolesResponsibilities,
      mealItems,
      rundown,
      challengesMitigations,
      activityDescription,
      expectedResults,
      location,
      startDate,
      endDate,
      reportingPeriodType,
      reportingFrequency,
      reportingDeadline,
      additionalNotes,
      activityStatus
    } = req.body;
    let outcomeName = existing.outcomeName;
    let outputName = existing.outputName;
    let activityName = existing.activityName;
    let picName = existing.picName;
    if (outcomeId && outcomeId !== existing.outcomeId) {
      const oc = data.outcomes.find((o) => o.id === outcomeId);
      if (oc) outcomeName = oc.name;
    }
    if (outputId && outputId !== existing.outputId) {
      const op = data.outputs.find((o) => o.id === outputId);
      if (op) outputName = op.name;
    }
    if (activityId && activityId !== existing.activityId) {
      const ac = data.activities.find((a) => a.id === activityId);
      if (ac) activityName = ac.name;
    }
    if (picId && picId !== existing.picId) {
      const pu = data.users.find((u) => u.id === picId);
      if (pu) picName = pu.name;
    }
    let updatedTor = null;
    db.update((d) => {
      const idx = d.tors.findIndex((t) => t.id === id);
      if (idx !== -1) {
        const wasApprovedEdit = d.tors[idx].editRequestStatus === "approved";
        const keepUnlockedForRevision = d.tors[idx].submissionStatus === "Perlu Perbaikan";
        d.tors[idx] = {
          ...d.tors[idx],
          // Rule 9: Nomor yang telah diterbitkan bersifat permanen, unik, dan tidak dapat diedit secara manual
          torNumber: existing.isOfficialNumber ? existing.torNumber : d.tors[idx].torNumber,
          isOfficialNumber: existing.isOfficialNumber,
          publishedAt: existing.publishedAt,
          torSequence: existing.torSequence,
          activityCode: existing.isOfficialNumber ? existing.activityCode : req.body.activityCode || d.tors[idx].activityCode,
          programCode: existing.isOfficialNumber ? existing.programCode : d.tors[idx].programCode,
          title: title ?? d.tors[idx].title,
          outcomeId: outcomeId ?? d.tors[idx].outcomeId,
          outcomeName,
          outputId: outputId ?? d.tors[idx].outputId,
          outputName,
          activityId: activityId ?? d.tors[idx].activityId,
          activityName,
          picId: picId ?? d.tors[idx].picId,
          picName,
          implementingTeam: implementingTeam ?? d.tors[idx].implementingTeam,
          background: background ?? d.tors[idx].background,
          rationale: rationale ?? d.tors[idx].rationale,
          generalObjective: generalObjective ?? d.tors[idx].generalObjective,
          objectives: objectives ?? d.tors[idx].objectives,
          participantType: req.body.participantType !== void 0 ? req.body.participantType : req.body.participantsType !== void 0 ? req.body.participantsType : d.tors[idx].participantType,
          participantsType: req.body.participantType !== void 0 ? req.body.participantType : req.body.participantsType !== void 0 ? req.body.participantsType : d.tors[idx].participantsType,
          participantsTarget: req.body.participantsTarget !== void 0 ? req.body.participantsTarget : d.tors[idx].participantsTarget,
          participantsCount: req.body.participantsCount !== void 0 ? req.body.participantsCount !== null && req.body.participantsCount !== "" ? Number(req.body.participantsCount) : null : d.tors[idx].participantsCount,
          participantsCriteria: req.body.participantsCriteria !== void 0 ? req.body.participantsCriteria : d.tors[idx].participantsCriteria,
          participantTableMode: req.body.participantTableMode !== void 0 ? req.body.participantTableMode : d.tors[idx].participantTableMode,
          participantRows: req.body.participantRows !== void 0 ? req.body.participantRows : d.tors[idx].participantRows,
          participantCustomColumns: req.body.participantCustomColumns !== void 0 ? req.body.participantCustomColumns : d.tors[idx].participantCustomColumns,
          goals: goals ?? d.tors[idx].goals,
          indicators: indicators ?? d.tors[idx].indicators,
          rolesResponsibilities: rolesResponsibilities ?? d.tors[idx].rolesResponsibilities,
          rolesNotes: req.body.rolesNotes !== void 0 ? req.body.rolesNotes : req.body.rolesAdditionalNotes !== void 0 ? req.body.rolesAdditionalNotes : d.tors[idx].rolesNotes,
          rolesAdditionalNotes: req.body.rolesNotes !== void 0 ? req.body.rolesNotes : req.body.rolesAdditionalNotes !== void 0 ? req.body.rolesAdditionalNotes : d.tors[idx].rolesAdditionalNotes,
          mealItems: mealItems ?? d.tors[idx].mealItems,
          rundown: rundown ?? d.tors[idx].rundown,
          rundownNotes: req.body.rundownNotes !== void 0 ? req.body.rundownNotes : req.body.rundownAdditionalNotes !== void 0 ? req.body.rundownAdditionalNotes : d.tors[idx].rundownNotes,
          rundownAdditionalNotes: req.body.rundownNotes !== void 0 ? req.body.rundownNotes : req.body.rundownAdditionalNotes !== void 0 ? req.body.rundownAdditionalNotes : d.tors[idx].rundownAdditionalNotes,
          challengesMitigations: challengesMitigations ?? d.tors[idx].challengesMitigations,
          challengesNotes: req.body.challengesNotes !== void 0 ? req.body.challengesNotes : req.body.challengesAdditionalNotes !== void 0 ? req.body.challengesAdditionalNotes : d.tors[idx].challengesNotes,
          challengesAdditionalNotes: req.body.challengesNotes !== void 0 ? req.body.challengesNotes : req.body.challengesAdditionalNotes !== void 0 ? req.body.challengesAdditionalNotes : d.tors[idx].challengesAdditionalNotes,
          activityDescription: activityDescription ?? d.tors[idx].activityDescription,
          expectedResults: expectedResults ?? d.tors[idx].expectedResults,
          location: location ?? d.tors[idx].location,
          locations: req.body.locations ?? d.tors[idx].locations,
          customPeriodId: req.body.customPeriodId !== void 0 ? req.body.customPeriodId : d.tors[idx].customPeriodId,
          customPeriodCode: req.body.customPeriodCode !== void 0 ? req.body.customPeriodCode : d.tors[idx].customPeriodCode,
          customPeriodLabel: req.body.customPeriodLabel !== void 0 ? req.body.customPeriodLabel : d.tors[idx].customPeriodLabel,
          customPeriodStartDate: req.body.customPeriodStartDate !== void 0 ? req.body.customPeriodStartDate : d.tors[idx].customPeriodStartDate,
          customPeriodEndDate: req.body.customPeriodEndDate !== void 0 ? req.body.customPeriodEndDate : d.tors[idx].customPeriodEndDate,
          customPeriodAllocatedAmount: req.body.customPeriodAllocatedAmount !== void 0 ? Number(req.body.customPeriodAllocatedAmount) : d.tors[idx].customPeriodAllocatedAmount,
          startDate: startDate ?? d.tors[idx].startDate,
          endDate: endDate ?? d.tors[idx].endDate,
          reportingPeriodType: reportingPeriodType ?? d.tors[idx].reportingPeriodType,
          reportingFrequency: reportingFrequency ?? d.tors[idx].reportingFrequency,
          reportingDeadline: reportingDeadline ?? d.tors[idx].reportingDeadline,
          additionalNotes: additionalNotes ?? d.tors[idx].additionalNotes,
          specificObjectives: req.body.specificObjectives !== void 0 ? req.body.specificObjectives : d.tors[idx].specificObjectives,
          timelineItems: req.body.timelineItems !== void 0 ? req.body.timelineItems : d.tors[idx].timelineItems,
          monitoringItems: req.body.monitoringItems !== void 0 ? req.body.monitoringItems : d.tors[idx].monitoringItems,
          scopeOfActivities: req.body.scopeOfActivities !== void 0 ? req.body.scopeOfActivities : d.tors[idx].scopeOfActivities,
          implementationMechanisms: req.body.implementationMechanisms !== void 0 ? req.body.implementationMechanisms : d.tors[idx].implementationMechanisms,
          isRundownVisible: req.body.isRundownVisible !== void 0 ? req.body.isRundownVisible : d.tors[idx].isRundownVisible,
          organizerPersonInCharge: req.body.organizerPersonInCharge !== void 0 ? req.body.organizerPersonInCharge : d.tors[idx].organizerPersonInCharge,
          // Keep edit unlocked if still in Perlu Perbaikan; relock back to final ('none') otherwise
          editRequestStatus: keepUnlockedForRevision ? "approved" : "none",
          activityStatus: activityStatus ?? d.tors[idx].activityStatus,
          budgetRequested: req.body.budgetRequested !== void 0 ? req.body.budgetRequested !== null && req.body.budgetRequested !== "" ? Number(req.body.budgetRequested) : null : d.tors[idx].budgetRequested,
          budgetApproved: req.body.budgetApproved !== void 0 ? req.body.budgetApproved !== null && req.body.budgetApproved !== "" ? Number(req.body.budgetApproved) : null : d.tors[idx].budgetApproved,
          budgetActualSpent: req.body.budgetActualSpent !== void 0 ? req.body.budgetActualSpent !== null && req.body.budgetActualSpent !== "" ? Number(req.body.budgetActualSpent) : null : d.tors[idx].budgetActualSpent,
          budgetNotes: req.body.budgetNotes ?? d.tors[idx].budgetNotes,
          budgetApprovalStatus: req.body.budgetApprovalStatus !== void 0 ? req.body.budgetApprovalStatus : d.tors[idx].budgetApprovalStatus,
          budgetDeterminedByFinanceName: req.body.budgetDeterminedByFinanceName !== void 0 ? req.body.budgetDeterminedByFinanceName : d.tors[idx].budgetDeterminedByFinanceName,
          budgetDeterminedByFinanceAt: req.body.budgetDeterminedByFinanceAt !== void 0 ? req.body.budgetDeterminedByFinanceAt : d.tors[idx].budgetDeterminedByFinanceAt,
          budgetUpdatedByA2Name: req.body.budgetUpdatedByA2Name !== void 0 ? req.body.budgetUpdatedByA2Name : d.tors[idx].budgetUpdatedByA2Name,
          budgetUpdatedByA2At: req.body.budgetUpdatedByA2At !== void 0 ? req.body.budgetUpdatedByA2At : d.tors[idx].budgetUpdatedByA2At,
          budgetApprovedByDirectorName: req.body.budgetApprovedByDirectorName !== void 0 ? req.body.budgetApprovedByDirectorName : d.tors[idx].budgetApprovedByDirectorName,
          budgetApprovedByDirectorAt: req.body.budgetApprovedByDirectorAt !== void 0 ? req.body.budgetApprovedByDirectorAt : d.tors[idx].budgetApprovedByDirectorAt,
          budgetAuditLogs: Array.isArray(req.body.budgetAuditLogs) ? req.body.budgetAuditLogs : d.tors[idx].budgetAuditLogs,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        updatedTor = d.tors[idx];
        const masterTor = d.tors[idx];
        if (Array.isArray(d.cashAdvances)) {
          d.cashAdvances = d.cashAdvances.map((ca) => {
            if (ca.torId !== id) return ca;
            const tlList = masterTor.timelineItems || [];
            const updatedItems = (ca.items || []).map((item) => {
              const matchedTl = tlList.find((t) => t.id === item.timelineItemId);
              return matchedTl ? {
                ...item,
                timelinePeriod: matchedTl.period,
                timelineActivity: matchedTl.activity
              } : item;
            });
            return {
              ...ca,
              torNumber: masterTor.torNumber,
              activityTitle: masterTor.title,
              programName: masterTor.programName || ca.programName,
              activityStartDate: masterTor.startDate,
              activityEndDate: masterTor.endDate,
              location: masterTor.location || ca.location,
              items: updatedItems
            };
          });
        }
        if (d.cashAdvanceSummaries && d.cashAdvanceSummaries[id]) {
          const tlList = masterTor.timelineItems || [];
          const sumObj = d.cashAdvanceSummaries[id];
          if (Array.isArray(sumObj.summaryRows)) {
            sumObj.summaryRows = sumObj.summaryRows.map((row) => {
              const matchedTl = tlList.find((t) => t.id === row.timelineItemId);
              return matchedTl ? {
                ...row,
                timelinePeriod: matchedTl.period,
                timelineActivity: matchedTl.activity
              } : row;
            });
          }
        }
        if (Array.isArray(d.meetingMinutes)) {
          d.meetingMinutes = d.meetingMinutes.map((mm) => {
            if (mm.torId !== id) return mm;
            return {
              ...mm,
              torNumber: masterTor.torNumber,
              meetingLocation: masterTor.location || mm.meetingLocation
            };
          });
        }
        if (wasApprovedEdit || currentUser.role === "director") {
          d.approvalRecords.push({
            id: `app-${Date.now()}`,
            torId: id,
            stage: "Akses Edit",
            action: "Simpan Edit",
            actorId: currentUser.id,
            actorName: currentUser.name,
            actorRole: currentUser.role,
            comment: "Perubahan dokumen Master TOR telah disimpan dan referensi seluruh tahapan hilir (Tahap 2\u20138) telah diperbarui.",
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            resultingStatus: d.tors[idx].submissionStatus
          });
        }
        syncApprovalHubData(d);
      }
    });
    res.json(updatedTor);
  });
  app.post("/api/tors/:id/budget-estimate", (req, res) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const { action, budgetRequested, budgetNotes } = req.body;
    const data = db.getData();
    const existing = data.tors.find((t) => t.id === id);
    if (!existing) {
      return res.status(404).json({ error: "TOR tidak ditemukan" });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const numericBudget = budgetRequested !== void 0 && budgetRequested !== null && !isNaN(Number(budgetRequested)) ? Number(budgetRequested) : Number(existing.budgetApproved || existing.budgetRequested || 0);
    let updatedTor = null;
    db.update((d) => {
      const idx = d.tors.findIndex((t) => t.id === id);
      if (idx === -1) return;
      const cur = d.tors[idx];
      const existingLogs = Array.isArray(cur.budgetAuditLogs) ? cur.budgetAuditLogs : [];
      if (action === "director_acc") {
        const logEntry = {
          id: `bgt-log-${Date.now()}`,
          timestamp: nowIso,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle || "Executive Director",
          actionLabel: `ACC Estimasi Budget ToR oleh Direktur \u2014 Budget yang disetujui untuk ini adalah Rp ${numericBudget.toLocaleString("id-ID")}`,
          amount: numericBudget,
          status: "Disetujui Direktur"
        };
        d.tors[idx] = {
          ...cur,
          budgetApproved: numericBudget,
          budgetApprovalStatus: "Disetujui Direktur",
          budgetApprovedByDirectorName: currentUser.name,
          budgetApprovedByDirectorAt: nowIso,
          budgetNotes: budgetNotes !== void 0 ? budgetNotes : cur.budgetNotes,
          budgetAuditLogs: [logEntry, ...existingLogs],
          updatedAt: nowIso
        };
      } else {
        const isFirstDetermine = action === "finance_determine" || !cur.budgetDeterminedByFinanceName;
        const logEntry = {
          id: `bgt-log-${Date.now()}`,
          timestamp: nowIso,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle || "A2 \u2013 Accountable Finance",
          actionLabel: isFirstDetermine ? `Penentuan Estimasi Budget ToR oleh Finance (Rp ${numericBudget.toLocaleString("id-ID")}) \u2014 Menunggu ACC Direktur` : `Update Estimasi Budget ToR oleh A2 / Finance (Rp ${numericBudget.toLocaleString("id-ID")}) \u2014 Menunggu ACC Direktur`,
          amount: numericBudget,
          status: "Menunggu ACC Direktur"
        };
        d.tors[idx] = {
          ...cur,
          budgetApproved: numericBudget,
          budgetApprovalStatus: "Menunggu ACC Direktur",
          budgetDeterminedByFinanceName: cur.budgetDeterminedByFinanceName || currentUser.name,
          budgetDeterminedByFinanceAt: cur.budgetDeterminedByFinanceAt || nowIso,
          budgetUpdatedByA2Name: currentUser.name,
          budgetUpdatedByA2At: nowIso,
          budgetNotes: budgetNotes !== void 0 ? budgetNotes : cur.budgetNotes,
          budgetAuditLogs: [logEntry, ...existingLogs],
          updatedAt: nowIso
        };
      }
      updatedTor = d.tors[idx];
      d.auditLogs.unshift({
        id: `log-bgt-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: action === "director_acc" ? "ACC Estimasi Budget ToR (Direktur)" : "Update Estimasi Budget ToR (Finance / A2)",
        entityType: "TOR",
        entityId: id,
        details: `${d.tors[idx].torNumber}: Estimasi Kebutuhan Anggaran Rp ${numericBudget.toLocaleString("id-ID")} (${d.tors[idx].budgetApprovalStatus}).`,
        timestamp: nowIso
      });
      syncApprovalHubData(d);
    });
    res.json(updatedTor);
  });
  app.post("/api/tors/:id/request-edit", (req, res) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const { reason } = req.body;
    const data = db.getData();
    const tor = data.tors.find((t) => t.id === id);
    if (!tor) return res.status(404).json({ error: "TOR tidak ditemukan" });
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: "Alasan permintaan edit wajib diisi" });
    }
    try {
      let updatedTor = null;
      let hubMessage = "";
      db.update((d) => {
        const result = executeApprovalHubAction({
          draft: d,
          itemId: `apv-tor-${id}`,
          actor: currentUser,
          action: "request_edit",
          comment: reason.trim()
        });
        hubMessage = result.message;
        updatedTor = d.tors.find((t) => t.id === id) || null;
      });
      res.json({
        message: hubMessage || "Permintaan edit berhasil masuk ke Approval ToR dan menunggu keputusan (ACC Edit) Direktur.",
        tor: updatedTor
      });
    } catch (err) {
      res.status(400).json({ error: err.message || "Gagal mengajukan permintaan edit ToR." });
    }
  });
  app.post("/api/tors/:id/review-edit-request", (req, res) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const { decision, comment } = req.body;
    if (currentUser.role !== "director") {
      return res.status(403).json({
        error: "Hanya Director yang berwenang menyetujui (ACC) atau menolak permintaan edit TOR."
      });
    }
    const data = db.getData();
    const tor = data.tors.find((t) => t.id === id);
    if (!tor) return res.status(404).json({ error: "TOR tidak ditemukan" });
    const isApprove = decision === "approve";
    try {
      let updatedTor = null;
      let hubMessage = "";
      db.update((d) => {
        const result = executeApprovalHubAction({
          draft: d,
          itemId: `apv-tor-${id}`,
          actor: currentUser,
          action: isApprove ? "approve_edit_request" : "reject_edit_request",
          comment: comment?.trim()
        });
        hubMessage = result.message;
        updatedTor = d.tors.find((t) => t.id === id) || null;
      });
      res.json({
        message: hubMessage || (isApprove ? "Permintaan edit berhasil di-ACC melalui Approval ToR. Dokumen kini dapat diedit." : "Permintaan edit telah ditolak melalui Approval ToR."),
        tor: updatedTor
      });
    } catch (err) {
      res.status(400).json({ error: err.message || "Gagal memproses keputusan Request Edit ToR." });
    }
  });
  app.post("/api/tors/:id/submit", (req, res) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const { comment } = req.body;
    const data = db.getData();
    const tor = data.tors.find((t) => t.id === id);
    if (!tor) return res.status(404).json({ error: "TOR tidak ditemukan" });
    if (tor.createdById !== currentUser.id && tor.picId !== currentUser.id && currentUser.role !== "director") {
      return res.status(403).json({ error: "Hanya pembuat / PIC TOR yang dapat mengajukan dokumen" });
    }
    if (tor.submissionStatus !== "Draft" && tor.submissionStatus !== "Perlu Perbaikan") {
      return res.status(400).json({ error: `TOR berstatus '${tor.submissionStatus}' tidak dapat diajukan kembali` });
    }
    let generatedOfficialNumber = tor.torNumber;
    let finalSubmissionStatus = "Menunggu Persetujuan Finance";
    try {
      db.update((d) => {
        const idx = d.tors.findIndex((t) => t.id === id);
        if (idx !== -1) {
          const targetTor = d.tors[idx];
          if (!targetTor.isOfficialNumber) {
            const prog = d.programs.find((p) => p.id === targetTor.programId);
            const progName = prog?.name || targetTor.programName || "Program";
            const progCode = generateProgramCode(progName, prog?.code);
            const { hierarchyCode } = computeHierarchyCode({
              programId: targetTor.programId,
              outcomeId: targetTor.outcomeId,
              outputId: targetTor.outputId,
              activityId: targetTor.activityId,
              outcomes: d.outcomes,
              outputs: d.outputs,
              activities: d.activities
            });
            const now = /* @__PURE__ */ new Date();
            const year = now.getFullYear();
            const nextSeq = getNextTorSequenceForYear(d, year);
            const romanMonth = getRomanMonth(now);
            generatedOfficialNumber = formatTorNumber({
              sequence: nextSeq,
              programCode: progCode,
              hierarchyCode,
              romanMonth,
              year
            });
            targetTor.torNumber = generatedOfficialNumber;
            targetTor.isOfficialNumber = true;
            targetTor.publishedAt = now.toISOString();
            targetTor.torSequence = nextSeq;
            targetTor.hierarchyCode = hierarchyCode;
            targetTor.activityCode = hierarchyCode;
            targetTor.programCode = progCode;
          }
        }
        executeApprovalHubAction({
          draft: d,
          itemId: `apv-tor-${id}`,
          actor: currentUser,
          action: "submit",
          comment: comment || void 0
        });
        const updatedTor = d.tors.find((t) => t.id === id);
        if (updatedTor) {
          finalSubmissionStatus = updatedTor.submissionStatus;
          generatedOfficialNumber = updatedTor.torNumber;
        }
      });
      res.json({
        message: "TOR berhasil diajukan ke A1 (Accountable Program)",
        submissionStatus: finalSubmissionStatus,
        torNumber: generatedOfficialNumber
      });
    } catch (err) {
      res.status(400).json({ error: err.message || "Gagal mengajukan TOR" });
    }
  });
  app.post("/api/tors/:id/review", (req, res) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const { action, comment } = req.body;
    if (!action || !["Setujui", "Tolak", "Minta Perbaikan"].includes(action)) {
      return res.status(400).json({ error: "Tindakan harus salah satu dari: 'Setujui', 'Tolak', 'Minta Perbaikan'" });
    }
    if ((action === "Tolak" || action === "Minta Perbaikan") && (!comment || !comment.trim())) {
      return res.status(400).json({ error: "Alasan dan komentar pemeriksa wajib diisi untuk penolakan atau permintaan perbaikan" });
    }
    const data = db.getData();
    const tor = data.tors.find((t) => t.id === id);
    if (!tor) return res.status(404).json({ error: "TOR tidak ditemukan" });
    if (tor.createdById === currentUser.id && currentUser.role !== "director") {
      return res.status(403).json({ error: "Pelanggaran Aturan: Pembuat TOR tidak diperbolehkan menyetujui dokumen yang dibuatnya sendiri." });
    }
    try {
      let resultingStatus = tor.submissionStatus;
      let hubMessage = "";
      db.update((d) => {
        syncApprovalHubData(d);
        const hubItem = d.approvalHubItems?.[`apv-tor-${id}`];
        if (!hubItem) {
          throw new Error("Item Approval ToR tidak ditemukan.");
        }
        let hubAction;
        if (action === "Minta Perbaikan") {
          hubAction = "revision";
        } else if (action === "Tolak") {
          hubAction = "reject";
        } else {
          if (currentUser.role === "director" && (hubItem.status === "Pending Approval" || hubItem.status === "Approved" || tor.submissionStatus === "Menunggu Persetujuan Director")) {
            hubAction = "director_final_approve";
          } else {
            hubAction = "verify_approve";
          }
        }
        const result = executeApprovalHubAction({
          draft: d,
          itemId: `apv-tor-${id}`,
          actor: currentUser,
          action: hubAction,
          comment: comment?.trim()
        });
        hubMessage = result.message;
        const updatedTor = d.tors.find((t) => t.id === id);
        if (updatedTor) {
          resultingStatus = updatedTor.submissionStatus;
        }
      });
      return res.json({
        message: hubMessage || `Tindakan '${action}' berhasil diproses`,
        submissionStatus: resultingStatus
      });
    } catch (err) {
      return res.status(400).json({
        error: err.message || "Gagal memproses peninjauan ToR."
      });
    }
  });
  app.put("/api/tors/:id/activity-status", (req, res) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const { activityStatus } = req.body;
    if (!["Belum Dimulai", "Sedang Berjalan", "Selesai"].includes(activityStatus)) {
      return res.status(400).json({ error: "Status kegiatan tidak valid" });
    }
    const data = db.getData();
    const tor = data.tors.find((t) => t.id === id);
    if (!tor) return res.status(404).json({ error: "TOR tidak ditemukan" });
    if (tor.picId !== currentUser.id && tor.createdById !== currentUser.id && currentUser.role !== "director" && currentUser.role !== "program_manager") {
      return res.status(403).json({ error: "Hanya PIC atau Pengelola Program yang dapat mengubah status pelaksanaan kegiatan" });
    }
    db.update((d) => {
      const idx = d.tors.findIndex((t) => t.id === id);
      if (idx !== -1) {
        d.tors[idx].activityStatus = activityStatus;
        d.tors[idx].updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      }
      d.auditLogs.unshift({
        id: `log-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: "Pembaruan Status Kegiatan",
        entityType: "TOR",
        entityId: tor.id,
        details: `${tor.torNumber} status kegiatan diubah menjadi: ${activityStatus}`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    });
    res.json({ message: "Status kegiatan berhasil diperbarui", activityStatus });
  });
  app.delete("/api/tors/:id", (req, res) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    if (currentUser.role !== "director") {
      return res.status(403).json({
        error: "Hanya Direktur yang memiliki kewenangan untuk menghapus dokumen ToR."
      });
    }
    const data = db.getData();
    const targetTor = (data.tors || []).find((t) => t.id === id);
    if (!targetTor) {
      return res.status(404).json({ error: "Dokumen ToR tidak ditemukan." });
    }
    db.update((d) => {
      d.tors = (d.tors || []).filter((t) => t.id !== id);
      d.approvalRecords = (d.approvalRecords || []).filter((r) => r.torId !== id);
      const removedCaIds = new Set(
        (d.cashAdvances || []).filter((ca) => ca.torId === id).map((ca) => ca.id)
      );
      d.cashAdvances = (d.cashAdvances || []).filter((ca) => ca.torId !== id);
      if (d.cashAdvanceSummaries && d.cashAdvanceSummaries[id]) {
        delete d.cashAdvanceSummaries[id];
      }
      if (d.cashAdvanceAuditLogs && d.cashAdvanceAuditLogs[id]) {
        delete d.cashAdvanceAuditLogs[id];
      }
      d.meetingMinutes = (d.meetingMinutes || []).filter((mm) => mm.torId !== id);
      d.activityDocumentationList = (d.activityDocumentationList || []).filter(
        (doc) => doc.torId !== id
      );
      if (d.activityDocumentations && d.activityDocumentations[id]) {
        delete d.activityDocumentations[id];
      }
      if (d.monitoringReports) {
        for (const key of Object.keys(d.monitoringReports)) {
          if (d.monitoringReports[key]?.torId === id) {
            delete d.monitoringReports[key];
          }
        }
      }
      if (d.approvalHubItems) {
        delete d.approvalHubItems[`apv-tor-${id}`];
        for (const caId of removedCaIds) {
          delete d.approvalHubItems[`apv-ca-${caId}`];
          delete d.approvalHubItems[`apv-finrep-${caId}`];
        }
      }
      syncApprovalHubData(d);
      d.auditLogs.unshift({
        id: `log-del-tor-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: "Penghapusan Dokumen TOR (Direktur)",
        entityType: "TOR",
        entityId: id,
        details: `Direktur (${currentUser.name}) menghapus dokumen TOR ${targetTor.torNumber}: "${targetTor.title}" beserta dokumen turunan terkait.`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    });
    res.json({
      message: `Dokumen ToR ${targetTor.torNumber} berhasil dihapus oleh Direktur.`,
      id
    });
  });
  app.get("/api/cash-advances", (req, res) => {
    const currentUser = getCurrentUser(req);
    const { torId, search, status } = req.query;
    const data = db.getData();
    let records = data.cashAdvances || [];
    if (currentUser.role === "staff" && !currentUser.permissions?.canViewAllTors) {
      records = records.filter((ca) => {
        if (ca.requesterId === currentUser.id) return true;
        const linkedTor = data.tors.find((t) => t.id === ca.torId);
        return linkedTor ? canUserAccessTorRecord(currentUser, linkedTor, data) : false;
      });
    }
    if (torId) {
      records = records.filter((ca) => ca.torId === String(torId));
    }
    if (status && status !== "all") {
      records = records.filter((ca) => ca.status === String(status));
    }
    if (search && typeof search === "string" && search.trim().length > 0) {
      const q = search.toLowerCase();
      records = records.filter(
        (ca) => ca.advanceNumber.toLowerCase().includes(q) || ca.torNumber.toLowerCase().includes(q) || ca.activityTitle.toLowerCase().includes(q) || ca.requesterName.toLowerCase().includes(q)
      );
    }
    records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json(records);
  });
  app.get("/api/cash-advances/:id", (req, res) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const data = db.getData();
    const ca = (data.cashAdvances || []).find((c) => c.id === id);
    if (!ca) {
      return res.status(404).json({ error: "Cash Advance tidak ditemukan" });
    }
    if (currentUser.role === "staff" && !currentUser.permissions?.canViewAllTors) {
      const linkedTor = data.tors.find((t) => t.id === ca.torId);
      const canView = ca.requesterId === currentUser.id || (linkedTor ? canUserAccessTorRecord(currentUser, linkedTor, data) : false);
      if (!canView) {
        return res.status(403).json({
          error: "Akses ditolak: Anda tidak memiliki izin untuk melihat dokumen Cash Advance ini."
        });
      }
    }
    res.json(ca);
  });
  app.post("/api/cash-advances", (req, res) => {
    const currentUser = getCurrentUser(req);
    const body = req.body;
    if (!body.torId) {
      return res.status(400).json({ error: "Referensi Dokumen TOR wajib dipilih" });
    }
    const data = db.getData();
    const targetTor = data.tors.find((t) => t.id === body.torId);
    if (!targetTor) {
      return res.status(400).json({ error: "TOR referensi tidak valid" });
    }
    const existingForTor = (data.cashAdvances || []).filter((c) => c.torId === targetTor.id);
    const unreportedForTor = existingForTor.filter((c) => !c.isReported && c.status !== "Ditolak");
    if (unreportedForTor.length >= 2) {
      return res.status(400).json({
        error: "Tidak dapat mengajukan Cash Advance baru karena masih terdapat 2 Cash Advance yang belum dilaporkan. Silakan tutup laporan pada menu Ringkasan Cash Advance beserta lampiran link PDF Expensify terlebih dahulu."
      });
    }
    const now = /* @__PURE__ */ new Date();
    const requestDateStr = body.requestDate || now.toISOString().slice(0, 10);
    const reqDateObj = new Date(requestDateStr);
    if (isNaN(reqDateObj.getTime())) {
      reqDateObj.setTime(now.getTime());
    }
    const deadlineObj = new Date(reqDateObj.getTime() + 7 * 24 * 60 * 60 * 1e3);
    const calculatedDeadlineStr = deadlineObj.toISOString().slice(0, 10);
    const cleanTor = (targetTor.torNumber || "").trim();
    let baseCa = "";
    if (/^TOR\//i.test(cleanTor)) baseCa = cleanTor.replace(/^TOR\//i, "CA/");
    else if (/^TOR\-/i.test(cleanTor)) baseCa = cleanTor.replace(/^TOR\-/i, "CA-");
    else if (/^TOR\_/i.test(cleanTor)) baseCa = cleanTor.replace(/^TOR\_/i, "CA_");
    else if (/^TOR\./i.test(cleanTor)) baseCa = cleanTor.replace(/^TOR\./i, "CA.");
    else if (/^TOR/i.test(cleanTor)) baseCa = cleanTor.replace(/^TOR/i, "CA/");
    else baseCa = `CA/${cleanTor}`;
    const seq = existingForTor.length + 1;
    const seqSuffix = `.${String(seq).padStart(2, "0")}`;
    let autoNumber = baseCa;
    if (/CA\/(\d+)\//.test(baseCa)) {
      autoNumber = baseCa.replace(/CA\/(\d+)\//, `CA/$1${seqSuffix}/`);
    } else if (/CA\-(\d+)\-/.test(baseCa)) {
      autoNumber = baseCa.replace(/CA\-(\d+)\-/, `CA-$1${seqSuffix}-`);
    } else if (/(\d{3,})/.test(baseCa)) {
      autoNumber = baseCa.replace(/(\d{3,})/, `$1${seqSuffix}`);
    } else {
      autoNumber = `${baseCa}${seqSuffix}`;
    }
    const newId = `ca-${Date.now()}`;
    const newRecord = {
      id: newId,
      advanceNumber: body.advanceNumber || autoNumber,
      requestDate: requestDateStr,
      organizationName: "Yayasan Inti Muda Indonesia (WIJNA)",
      requesterId: currentUser.id,
      requesterName: currentUser.name,
      requesterRole: currentUser.roleTitle,
      department: currentUser.department || "Program & Implementasi Lapangan",
      torId: targetTor.id,
      torNumber: targetTor.torNumber,
      activityTitle: targetTor.title,
      programName: targetTor.programName || "Program Yayasan Inti Muda Indonesia",
      activityStartDate: targetTor.startDate,
      activityEndDate: targetTor.endDate,
      location: targetTor.location || body.location || "",
      bankName: body.bankName || "Bank Mandiri",
      bankAccountNumber: body.bankAccountNumber || "",
      bankAccountHolder: body.bankAccountHolder || currentUser.name,
      items: Array.isArray(body.items) ? body.items : [],
      totalAmount: Number(body.totalAmount) || 0,
      amountInWords: body.amountInWords || "",
      complianceNotes: body.complianceNotes || [
        "1. Dilaporkan paling lambat 7 (tujuh) hari setelah pengajuan dana disertai lampiran link PDF Expensify.",
        "2. Tidak dapat mengajukan Cash Advance baru apabila masih terdapat 2 Cash Advance yang belum dilaporkan.",
        "3. Sisa saldo kasbon yang tidak terpakai wajib dikembalikan ke rekening kas organisasi saat rekonsiliasi."
      ],
      implementationMode: body.implementationMode === "single" ? "single" : "all",
      implementationTimelineIds: Array.isArray(body.implementationTimelineIds) ? body.implementationTimelineIds : [],
      implementationTimelineSummary: body.implementationTimelineSummary || "Seluruh Tahapan Implementation Timeline",
      reportingCommitment: body.reportingCommitment || "Dilaporkan paling lambat 7 (tujuh) hari setelah pengajuan dana",
      reportingDeadlineDate: body.reportingDeadlineDate || calculatedDeadlineStr,
      isReported: false,
      signatures: {
        requestedBy: {
          name: currentUser.name,
          roleTitle: currentUser.roleTitle,
          date: now.toISOString().slice(0, 10),
          status: body.status === "Diajukan" ? "Diajukan" : "Draft",
          signatureNote: body.requestedNote || "Pengajuan uang muka operasional diajukan secara resmi."
        },
        verifiedBy: {
          name: "",
          roleTitle: "Finance Specialist",
          date: "",
          status: "Pending",
          notes: ""
        },
        approvedBy: {
          name: "",
          roleTitle: "Director",
          date: "",
          status: "Pending",
          notes: ""
        }
      },
      status: body.status || "Draft",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
    db.update((draft) => {
      if (!draft.cashAdvances) draft.cashAdvances = [];
      draft.cashAdvances.push(newRecord);
      syncTorBudgetInDraft(draft, targetTor.id);
      syncApprovalHubData(draft);
      if (newRecord.status === "Diajukan") {
        const hubItem = draft.approvalHubItems?.[`apv-ca-${newRecord.id}`];
        if (hubItem) {
          if (!draft.approvalNotifications) draft.approvalNotifications = [];
          draft.approvalNotifications = draft.approvalNotifications.filter(
            (n) => n.id !== `notif-init-${hubItem.id}` && n.approvalItemId !== hubItem.id
          );
          const a2Targets = [hubItem.accountableFinanceUserId].filter(
            (uid) => Boolean(uid)
          );
          draft.approvalNotifications.unshift({
            id: `notif-ca-create-${Date.now()}`,
            approvalItemId: hubItem.id,
            referenceNumber: newRecord.advanceNumber,
            documentTitle: `Cash Advance: ${newRecord.activityTitle}`,
            categoryCode: "cash_advance",
            categoryLabel: "Cash Advance Request",
            eventType: "NEW_SUBMISSION",
            message: `[Cash Advance Request] "${newRecord.activityTitle}" (${newRecord.advanceNumber}) telah diajukan oleh ${currentUser.name} dan menunggu verifikasi Finance (A2: ${hubItem.accountableFinanceUserName || "Finance"}).`,
            targetUserIds: a2Targets,
            targetRoleCodes: ["A2"],
            createdAt: now.toISOString(),
            isReadByUserIds: []
          });
        }
      }
      draft.auditLogs.unshift({
        id: `log-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: "Pembuatan Formulir Cash Advance",
        entityType: "TOR",
        entityId: targetTor.id,
        details: `Formulir ${newRecord.advanceNumber} (${newRecord.implementationTimelineSummary}) dibuat untuk TOR ${targetTor.torNumber} senilai ${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(newRecord.totalAmount)}. Batas pelaporan H+7: ${newRecord.reportingDeadlineDate}`,
        timestamp: now.toISOString()
      });
    });
    res.status(201).json(newRecord);
  });
  app.post("/api/cash-advances/:id/close-report", (req, res) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);
    const { expensifyPdfLink, realizedAmount, reportNotes, itemRealizations } = req.body;
    const now = /* @__PURE__ */ new Date();
    const nowIso = now.toISOString();
    if (!expensifyPdfLink || typeof expensifyPdfLink !== "string" || !expensifyPdfLink.trim()) {
      return res.status(400).json({
        error: "Kewajiban melampirkan Link PDF Expensify wajib diisi sebelum menutup laporan Cash Advance."
      });
    }
    let updatedRecord = null;
    db.update((draft) => {
      if (!draft.cashAdvances) return;
      const found = draft.cashAdvances.find((c) => c.id === id);
      if (!found) return;
      if (itemRealizations && typeof itemRealizations === "object" && Array.isArray(found.items)) {
        found.items = found.items.map((it) => {
          const val = itemRealizations[it.id];
          if (val !== void 0 && !isNaN(Number(val))) {
            return { ...it, actualSpent: Math.max(0, Number(val)) };
          }
          return it;
        });
      }
      const computedRealized = realizedAmount !== void 0 && !isNaN(Number(realizedAmount)) ? Math.max(0, Number(realizedAmount)) : (found.items || []).reduce((sum, it) => sum + (Number(it.actualSpent) || 0), 0);
      found.isReported = true;
      found.reportedAt = nowIso;
      found.reportedByName = found.requesterName || currentUser.name;
      found.expensifyPdfLink = expensifyPdfLink.trim();
      found.realizedAmount = computedRealized;
      found.reportNotes = reportNotes ? String(reportNotes).trim() : "";
      found.reportApprovalStatus = "Menunggu Pemeriksaan Finance";
      found.updatedAt = nowIso;
      updatedRecord = found;
      syncTorBudgetInDraft(draft, found.torId);
      syncApprovalHubData(draft);
      const finHubItem = draft.approvalHubItems?.[`apv-finrep-${found.id}`];
      if (finHubItem) {
        finHubItem.timeline = finHubItem.timeline || [];
        finHubItem.timeline.unshift({
          id: `tl-finrep-sub-${found.id}-${Date.now()}`,
          timestamp: nowIso,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRoleCode: "R",
          actorRoleTitle: currentUser.roleTitle || "PIC Kegiatan",
          responsibleName: found.requesterName,
          actionLabel: "Mengirimkan Final Financial Report ke Finance (A2)",
          resultingStatus: "Pending Verification",
          comment: found.reportNotes || `Laporan pertanggungjawaban dikirim dengan realisasi Rp ${computedRealized.toLocaleString("id-ID")} & lampiran PDF Expensify.`,
          version: finHubItem.version || 1
        });
        if (!draft.approvalNotifications) draft.approvalNotifications = [];
        const a2Targets = [finHubItem.accountableFinanceUserId].filter(
          (uid) => Boolean(uid)
        );
        draft.approvalNotifications.unshift({
          id: `notif-finrep-sub-${Date.now()}`,
          approvalItemId: finHubItem.id,
          referenceNumber: finHubItem.referenceNumber,
          documentTitle: finHubItem.title,
          categoryCode: "laporan_keuangan_akhir",
          categoryLabel: "Final Financial Report",
          eventType: "NEW_SUBMISSION",
          message: `[Final Financial Report] "${finHubItem.title}" (${finHubItem.referenceNumber}) telah dikirim oleh ${currentUser.name} dan menunggu verifikasi Finance (A2: ${finHubItem.accountableFinanceUserName || "Finance"}).`,
          targetUserIds: a2Targets,
          targetRoleCodes: ["A2"],
          createdAt: nowIso,
          isReadByUserIds: []
        });
      }
      if (!draft.cashAdvanceAuditLogs) draft.cashAdvanceAuditLogs = {};
      if (!draft.cashAdvanceAuditLogs[found.torId]) draft.cashAdvanceAuditLogs[found.torId] = [];
      const remaining = (found.items || []).reduce(
        (sum, it) => sum + Math.max(0, (Number(it.totalAmount) || 0) - (Number(it.actualSpent ?? it.totalAmount) || 0)),
        0
      );
      const shortage = (found.items || []).reduce(
        (sum, it) => sum + Math.max(0, (Number(it.actualSpent ?? it.totalAmount) || 0) - (Number(it.totalAmount) || 0)),
        0
      );
      const pct = found.totalAmount > 0 ? Math.round(computedRealized / found.totalAmount * 100) : 0;
      draft.cashAdvanceAuditLogs[found.torId].unshift({
        id: `audit-close-${Date.now()}`,
        torId: found.torId,
        timestamp: nowIso,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.role,
        action: "Tutup Laporan Cash Advance (Expensify PDF)",
        details: `Menutup laporan ${found.advanceNumber} (${found.implementationTimelineSummary || "Implementasi"}) dengan Realisasi Rp ${computedRealized.toLocaleString("id-ID")} dan lampiran Link PDF Expensify: ${found.expensifyPdfLink}. Status: Menunggu Pemeriksaan Finance.`,
        totalAdvance: found.totalAmount,
        totalSpent: computedRealized,
        totalRemaining: remaining,
        totalShortage: shortage,
        percentUsed: pct,
        itemCount: (found.items || []).length
      });
      draft.auditLogs.unshift({
        id: `log-close-ca-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: "Tutup Laporan Cash Advance",
        entityType: "TOR",
        entityId: found.torId,
        details: `Laporan Cash Advance ${found.advanceNumber} telah ditutup oleh ${currentUser.name}. Realisasi: Rp ${computedRealized.toLocaleString("id-ID")}. Link PDF Expensify: ${found.expensifyPdfLink}`,
        timestamp: nowIso
      });
    });
    if (!updatedRecord) {
      return res.status(404).json({ error: "Cash Advance tidak ditemukan" });
    }
    res.json(updatedRecord);
  });
  app.post("/api/cash-advances/:id/approve-report", (req, res) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);
    const { stage, action, notes } = req.body;
    const now = /* @__PURE__ */ new Date();
    const nowIso = now.toISOString();
    let updatedRecord = null;
    try {
      db.update((draft) => {
        if (!draft.cashAdvances) return;
        const found = draft.cashAdvances.find((c) => c.id === id);
        if (!found) return;
        if (!found.isReported) {
          throw new Error("Laporan keuangan belum dikirimkan oleh Responsible (R).");
        }
        if (stage === "finance") {
          if (currentUser.role !== "finance" && currentUser.role !== "admin") {
            throw new Error("Hanya Finance (A2) yang berwenang memverifikasi laporan keuangan akhir.");
          }
          if (found.reportApprovalStatus === "Telah Disetujui") {
            throw new Error("Laporan keuangan sudah disetujui akhir dan tidak dapat diubah.");
          }
          if (action === "revision") {
            found.reportApprovalStatus = "Perlu Revisi";
            found.reportVerifiedByName = currentUser.name;
            found.reportVerifiedAt = nowIso;
            found.reportVerifiedNotes = notes || "Laporan perlu diperbaiki.";
          } else {
            found.reportApprovalStatus = "Menunggu Persetujuan Director";
            found.reportVerifiedByName = currentUser.name;
            found.reportVerifiedAt = nowIso;
            found.reportVerifiedNotes = notes || "Laporan realisasi & lampiran Expensify telah diperiksa Finance.";
          }
        } else if (stage === "director") {
          if (currentUser.role !== "director" && currentUser.role !== "admin") {
            throw new Error("Hanya Executive Director yang berwenang memberikan persetujuan akhir laporan keuangan.");
          }
          if (found.reportApprovalStatus !== "Menunggu Persetujuan Director" && action !== "revision") {
            throw new Error("Laporan keuangan harus diverifikasi oleh Finance (A2) terlebih dahulu sebelum disetujui Direktur.");
          }
          if (action === "revision") {
            found.reportApprovalStatus = "Perlu Revisi";
            found.reportApprovedByName = currentUser.name;
            found.reportApprovedAt = nowIso;
            found.reportApprovedNotes = notes || "Laporan perlu revisi dari Director.";
          } else {
            found.reportApprovalStatus = "Telah Disetujui";
            found.reportApprovedByName = currentUser.name;
            found.reportApprovedAt = nowIso;
            found.reportApprovedNotes = notes || "Penutupan laporan Cash Advance telah disetujui Executive Director.";
          }
        }
        found.updatedAt = nowIso;
        updatedRecord = found;
        syncTorBudgetInDraft(draft, found.torId);
        syncApprovalHubData(draft);
        const finHubItem = draft.approvalHubItems?.[`apv-finrep-${found.id}`];
        const parentTor = (draft.tors || []).find((t) => t.id === found.torId);
        const directorIds = (draft.users || []).filter((u) => u.role === "director" && u.isActive !== false).map((u) => u.id);
        const reqTargets = Array.from(
          new Set(
            [found.requesterId, parentTor?.picId, parentTor?.createdById].filter(
              (uid) => Boolean(uid)
            )
          )
        );
        if (finHubItem) {
          finHubItem.timeline = finHubItem.timeline || [];
          finHubItem.timeline.unshift({
            id: `tl-finrep-${stage}-${found.id}-${Date.now()}`,
            timestamp: nowIso,
            actorId: currentUser.id,
            actorName: currentUser.name,
            actorRoleCode: stage === "finance" ? "A2" : "Direktur",
            actorRoleTitle: currentUser.roleTitle || (stage === "finance" ? "Finance Specialist" : "Executive Director"),
            responsibleName: found.requesterName,
            actionLabel: action === "revision" ? `Mengembalikan Final Financial Report untuk Revisi (${stage === "finance" ? "A2" : "Direktur"})` : stage === "finance" ? "Memverifikasi Final Financial Report (Tahap A2) -> Diteruskan ke Direktur" : "Menyetujui Akhir Final Financial Report (Direktur)",
            resultingStatus: finHubItem.status,
            comment: notes || (stage === "finance" ? found.reportVerifiedNotes || "Diverifikasi oleh Finance." : found.reportApprovedNotes || "Disetujui oleh Direktur."),
            version: finHubItem.version || 1
          });
          if (!draft.approvalNotifications) draft.approvalNotifications = [];
          draft.approvalNotifications.unshift({
            id: `notif-finrep-${stage}-${Date.now()}`,
            approvalItemId: finHubItem.id,
            referenceNumber: finHubItem.referenceNumber,
            documentTitle: finHubItem.title,
            categoryCode: "laporan_keuangan_akhir",
            categoryLabel: "Final Financial Report",
            eventType: action === "revision" ? "REVISION_REQUIRED" : stage === "finance" ? "ENTER_VERIFICATION" : "FINAL_COMPLETED",
            message: action === "revision" ? `[Perlu Revisi \xB7 Final Financial Report] "${finHubItem.title}" dikembalikan oleh ${currentUser.name}: "${notes || "Mohon perbaiki sesuai catatan"}".` : stage === "finance" ? `[Final Financial Report] "${finHubItem.title}" telah diverifikasi oleh Finance (${currentUser.name}) dan menunggu Persetujuan Akhir Direktur.` : `[Disetujui Akhir \xB7 Final Financial Report] "${finHubItem.title}" telah disetujui penuh oleh Direktur (${currentUser.name}).`,
            targetUserIds: action === "revision" ? reqTargets : stage === "finance" ? Array.from(/* @__PURE__ */ new Set([...directorIds, ...reqTargets])) : reqTargets,
            targetRoleCodes: action === "revision" ? ["R"] : stage === "finance" ? ["Direktur", "R"] : ["R", "A2"],
            createdAt: nowIso,
            isReadByUserIds: []
          });
        }
        if (!draft.cashAdvanceAuditLogs) draft.cashAdvanceAuditLogs = {};
        if (!draft.cashAdvanceAuditLogs[found.torId]) draft.cashAdvanceAuditLogs[found.torId] = [];
        const computedRealized = Number(found.realizedAmount ?? found.totalAmount) || 0;
        const remaining = (found.items || []).reduce(
          (sum, it) => sum + Math.max(0, (Number(it.totalAmount) || 0) - (Number(it.actualSpent ?? it.totalAmount) || 0)),
          0
        );
        const shortage = (found.items || []).reduce(
          (sum, it) => sum + Math.max(0, (Number(it.actualSpent ?? it.totalAmount) || 0) - (Number(it.totalAmount) || 0)),
          0
        );
        const pct = found.totalAmount > 0 ? Math.round(computedRealized / found.totalAmount * 100) : 0;
        const stageLabel = stage === "finance" ? "Pemeriksaan Finance" : "Persetujuan Director";
        draft.cashAdvanceAuditLogs[found.torId].unshift({
          id: `audit-rep-app-${Date.now()}`,
          torId: found.torId,
          timestamp: nowIso,
          actorId: currentUser.id,
          actorName: stage === "finance" ? found.reportVerifiedByName || currentUser.name : found.reportApprovedByName || currentUser.name,
          actorRole: stage === "finance" ? "Finance & Compliance" : "Executive Director",
          action: `${stageLabel} \u2014 Tutup Laporan (${found.advanceNumber})`,
          details: `${stageLabel} telah memproses laporan ${found.advanceNumber}. Status: ${found.reportApprovalStatus}.`,
          totalAdvance: found.totalAmount,
          totalSpent: computedRealized,
          totalRemaining: remaining,
          totalShortage: shortage,
          percentUsed: pct,
          itemCount: (found.items || []).length
        });
      });
    } catch (err) {
      return res.status(400).json({ error: err.message || "Gagal memproses persetujuan laporan." });
    }
    if (!updatedRecord) {
      return res.status(404).json({ error: "Cash Advance tidak ditemukan" });
    }
    res.json(updatedRecord);
  });
  app.put("/api/cash-advances/:id", (req, res) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);
    const body = req.body;
    let updatedRecord = null;
    try {
      db.update((draft) => {
        if (!draft.cashAdvances) return;
        const index = draft.cashAdvances.findIndex((c) => c.id === id);
        if (index === -1) return;
        const existing = draft.cashAdvances[index];
        if ((existing.status === "Disetujui" || existing.status === "Dicairkan") && currentUser.role !== "director" && currentUser.role !== "finance") {
          throw new Error(
            `Cash Advance ${existing.advanceNumber} telah berstatus '${existing.status}' dan rincian pengajuannya tidak dapat diubah lagi.`
          );
        }
        const recordToSave = {
          ...existing,
          ...body,
          id: existing.id,
          advanceNumber: existing.advanceNumber,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        updatedRecord = recordToSave;
        draft.cashAdvances[index] = recordToSave;
        syncTorBudgetInDraft(draft, existing.torId);
        syncApprovalHubData(draft);
        draft.auditLogs.unshift({
          id: `log-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: "Pembaruan Cash Advance",
          entityType: "TOR",
          entityId: existing.torId,
          details: `Formulir kasbon ${existing.advanceNumber} diperbarui. Total: ${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(recordToSave.totalAmount)}`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      });
    } catch (err) {
      return res.status(400).json({ error: err.message || "Gagal memperbarui Cash Advance." });
    }
    if (!updatedRecord) {
      return res.status(404).json({ error: "Cash Advance tidak ditemukan" });
    }
    res.json(updatedRecord);
  });
  app.post("/api/cash-advances/:id/submit", (req, res) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);
    const now = /* @__PURE__ */ new Date();
    const nowIso = now.toISOString();
    let record = null;
    try {
      db.update((draft) => {
        if (!draft.cashAdvances) return;
        const found = draft.cashAdvances.find((c) => c.id === id);
        if (!found) return;
        if (found.status !== "Draft" && found.status !== "Perlu Perbaikan") {
          throw new Error(
            `Cash Advance berstatus '${found.status}' sudah diajukan atau diproses (pencegahan double submission).`
          );
        }
        const wasRevision = found.status === "Perlu Perbaikan";
        found.status = "Diajukan";
        found.signatures.requestedBy = {
          name: currentUser.name,
          roleTitle: currentUser.roleTitle,
          date: nowIso.slice(0, 10),
          status: "Diajukan",
          signatureNote: req.body.note || "Telah diajukan secara resmi untuk ditinjau bagian Keuangan."
        };
        found.updatedAt = nowIso;
        record = found;
        syncTorBudgetInDraft(draft, found.torId);
        syncApprovalHubData(draft);
        const hubItem = draft.approvalHubItems?.[`apv-ca-${found.id}`];
        if (hubItem) {
          if (wasRevision) {
            hubItem.version = (hubItem.version || 1) + 1;
          }
          hubItem.timeline = hubItem.timeline || [];
          hubItem.timeline.unshift({
            id: `tl-ca-sub-${found.id}-${Date.now()}`,
            timestamp: nowIso,
            actorId: currentUser.id,
            actorName: currentUser.name,
            actorRoleCode: "R",
            actorRoleTitle: currentUser.roleTitle || "PIC Kegiatan",
            responsibleName: found.requesterName,
            actionLabel: wasRevision ? `Mengajukan Ulang Cash Advance (Revisi v${hubItem.version}) ke Finance (A2)` : "Mengajukan Cash Advance ke Finance (A2)",
            resultingStatus: "Pending Verification",
            comment: found.signatures.requestedBy?.signatureNote || "Cash Advance diajukan ke Finance (A2) untuk verifikasi.",
            version: hubItem.version || 1
          });
          if (!draft.approvalNotifications) draft.approvalNotifications = [];
          const a2Targets = [hubItem.accountableFinanceUserId].filter(
            (uid) => Boolean(uid)
          );
          draft.approvalNotifications.unshift({
            id: `notif-ca-sub-${Date.now()}`,
            approvalItemId: hubItem.id,
            referenceNumber: found.advanceNumber,
            documentTitle: `Cash Advance: ${found.activityTitle}`,
            categoryCode: "cash_advance",
            categoryLabel: "Cash Advance Request",
            eventType: "NEW_SUBMISSION",
            message: `[Cash Advance Request] "${found.activityTitle}" (${found.advanceNumber}) telah ${wasRevision ? "diajukan ulang" : "diajukan"} oleh ${currentUser.name} dan menunggu verifikasi Finance (A2: ${hubItem.accountableFinanceUserName || "Finance"}).`,
            targetUserIds: a2Targets,
            targetRoleCodes: ["A2"],
            createdAt: nowIso,
            isReadByUserIds: []
          });
        }
        draft.auditLogs.unshift({
          id: `log-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: wasRevision ? "Pengajuan Ulang Kasbon ke Finance" : "Pengajuan Kasbon ke Finance",
          entityType: "TOR",
          entityId: found.torId,
          details: `Cash Advance ${found.advanceNumber} diajukan ke Keuangan (A2) untuk verifikasi plafon.`,
          timestamp: nowIso
        });
      });
    } catch (err) {
      return res.status(400).json({ error: err.message || "Gagal mengajukan Cash Advance." });
    }
    if (!record) return res.status(404).json({ error: "Cash Advance tidak ditemukan" });
    res.json(record);
  });
  app.post("/api/cash-advances/:id/verify", (req, res) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== "finance" && currentUser.role !== "admin") {
      return res.status(403).json({
        error: "Akses ditolak: Hanya Finance (A2) yang berwenang memverifikasi pengajuan Cash Advance."
      });
    }
    const { action, notes } = req.body;
    const now = /* @__PURE__ */ new Date();
    const nowIso = now.toISOString();
    let record = null;
    let errMsg = null;
    db.update((draft) => {
      if (!draft.cashAdvances) return;
      const found = draft.cashAdvances.find((c) => c.id === id);
      if (!found) return;
      if (found.requesterId === currentUser.id && currentUser.role !== "director") {
        errMsg = "Pemohon Cash Advance tidak diperbolehkan memverifikasi pengajuannya sendiri.";
        return;
      }
      if (action === "verify") {
        found.status = "Diverifikasi Finance";
        found.signatures.verifiedBy = {
          name: currentUser.name,
          roleTitle: currentUser.roleTitle || "Finance Specialist",
          date: nowIso.slice(0, 10),
          status: "Terverifikasi",
          notes: notes || "Pagu anggaran, rincian biaya, dan kelengkapan administrasi telah diverifikasi valid."
        };
      } else if (action === "revision") {
        found.status = "Perlu Perbaikan";
        found.signatures.verifiedBy = {
          name: currentUser.name,
          roleTitle: currentUser.roleTitle || "Finance Specialist",
          date: nowIso.slice(0, 10),
          status: "Perlu Perbaikan",
          notes: notes || "Perlu penyesuaian rincian item kasbon."
        };
      } else {
        found.status = "Ditolak";
        found.signatures.verifiedBy = {
          name: currentUser.name,
          roleTitle: currentUser.roleTitle || "Finance Specialist",
          date: nowIso.slice(0, 10),
          status: "Ditolak",
          notes: notes || "Pengajuan ditolak oleh Finance."
        };
      }
      found.updatedAt = nowIso;
      record = found;
      syncTorBudgetInDraft(draft, found.torId);
      syncApprovalHubData(draft);
      const hubItem = draft.approvalHubItems?.[`apv-ca-${found.id}`];
      const parentTor = (draft.tors || []).find((t) => t.id === found.torId);
      const directorIds = (draft.users || []).filter((u) => u.role === "director").map((u) => u.id);
      const reqTargets = Array.from(
        new Set(
          [found.requesterId, parentTor?.picId, parentTor?.createdById].filter(
            (id2) => Boolean(id2)
          )
        )
      );
      if (hubItem) {
        hubItem.timeline = hubItem.timeline || [];
        hubItem.timeline.unshift({
          id: `tl-ca-ver-${found.id}-${Date.now()}`,
          timestamp: nowIso,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRoleCode: "A2",
          actorRoleTitle: currentUser.roleTitle || "Finance Specialist",
          responsibleName: found.requesterName,
          actionLabel: action === "verify" ? "Memverifikasi Cash Advance (Tahap A2)" : action === "revision" ? "Mengembalikan Cash Advance untuk Perbaikan (A2)" : "Menolak Pengajuan Cash Advance (A2)",
          resultingStatus: hubItem.status,
          comment: found.signatures.verifiedBy?.notes || "Verifikasi Cash Advance oleh Finance.",
          version: hubItem.version || 1
        });
      }
      if (!draft.approvalNotifications) draft.approvalNotifications = [];
      draft.approvalNotifications.unshift({
        id: `notif-ca-ver-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        approvalItemId: `apv-ca-${found.id}`,
        referenceNumber: found.advanceNumber,
        documentTitle: `Cash Advance: ${found.activityTitle}`,
        categoryCode: "cash_advance",
        categoryLabel: "Cash Advance Request",
        eventType: action === "verify" ? "ENTER_VERIFICATION" : action === "revision" ? "REVISION_REQUIRED" : "REJECTED",
        message: action === "verify" ? `[Cash Advance Request] "${found.activityTitle}" (${found.advanceNumber}) telah diverifikasi oleh Finance (${currentUser.name}) dan menunggu Persetujuan Akhir Direktur.` : action === "revision" ? `[Cash Advance Request] "${found.activityTitle}" (${found.advanceNumber}) dikembalikan untuk perbaikan oleh Finance (${currentUser.name}): "${found.signatures.verifiedBy?.notes || ""}"` : `[Cash Advance Request] "${found.activityTitle}" (${found.advanceNumber}) ditolak oleh Finance (${currentUser.name}): "${found.signatures.verifiedBy?.notes || ""}"`,
        targetUserIds: action === "verify" ? Array.from(/* @__PURE__ */ new Set([...directorIds, ...reqTargets])) : reqTargets,
        targetRoleCodes: action === "verify" ? ["Direktur", "R"] : ["R"],
        createdAt: nowIso,
        isReadByUserIds: []
      });
      draft.auditLogs.unshift({
        id: `log-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: `Verifikasi Kasbon: ${action}`,
        entityType: "TOR",
        entityId: found.torId,
        details: `Finance ${action === "verify" ? "menyetujui verifikasi" : action} pada kasbon ${found.advanceNumber}. Catatan: ${notes || "-"}`,
        timestamp: nowIso
      });
    });
    if (errMsg) return res.status(403).json({ error: errMsg });
    if (!record) return res.status(404).json({ error: "Cash Advance tidak ditemukan" });
    res.json(record);
  });
  app.post("/api/cash-advances/:id/approve", (req, res) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== "director") {
      return res.status(403).json({
        error: "Akses ditolak: Hanya Executive Director yang berwenang memberikan persetujuan akhir Cash Advance."
      });
    }
    const { action, notes } = req.body;
    const now = /* @__PURE__ */ new Date();
    const nowIso = now.toISOString();
    let record = null;
    db.update((draft) => {
      if (!draft.cashAdvances) return;
      const found = draft.cashAdvances.find((c) => c.id === id);
      if (!found) return;
      if (action === "approve") {
        found.status = "Disetujui";
        found.signatures.approvedBy = {
          name: currentUser.name,
          roleTitle: currentUser.roleTitle || "Director",
          date: nowIso.slice(0, 10),
          status: "Disetujui",
          notes: notes || "Otorisasi pencairan dana operasional telah disetujui Direktur."
        };
      } else {
        found.status = "Ditolak";
        found.signatures.approvedBy = {
          name: currentUser.name,
          roleTitle: currentUser.roleTitle || "Director",
          date: nowIso.slice(0, 10),
          status: "Ditolak",
          notes: notes || "Ditolak oleh Direktur."
        };
      }
      found.updatedAt = nowIso;
      record = found;
      syncTorBudgetInDraft(draft, found.torId);
      syncApprovalHubData(draft);
      const hubItem = draft.approvalHubItems?.[`apv-ca-${found.id}`];
      const parentTor = (draft.tors || []).find((t) => t.id === found.torId);
      const financeUserIds = (draft.users || []).filter(
        (u) => u.role === "finance" || (u.roleTitle || "").toLowerCase().includes("finance") || (u.roleTitle || "").toLowerCase().includes("kasir")
      ).map((u) => u.id);
      const reqTargets = Array.from(
        new Set(
          [found.requesterId, parentTor?.picId, parentTor?.createdById].filter(
            (id2) => Boolean(id2)
          )
        )
      );
      if (hubItem) {
        hubItem.timeline = hubItem.timeline || [];
        hubItem.timeline.unshift({
          id: `tl-ca-dir-${found.id}-${Date.now()}`,
          timestamp: nowIso,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRoleCode: "Direktur",
          actorRoleTitle: currentUser.roleTitle || "Executive Director",
          responsibleName: found.requesterName,
          actionLabel: action === "approve" ? "Menyetujui Akhir Cash Advance (Direktur) \u2014 Siap Dicairkan Finance" : "Menolak Pengajuan Cash Advance (Direktur)",
          resultingStatus: hubItem.status,
          comment: found.signatures.approvedBy?.notes || (action === "approve" ? "Disetujui oleh Direktur. Menunggu pencairan dana oleh Finance ke rekening pengaju." : "Ditolak oleh Direktur."),
          version: hubItem.version || 1
        });
      }
      if (!draft.approvalNotifications) draft.approvalNotifications = [];
      const formattedAmt = new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0
      }).format(found.totalAmount);
      draft.approvalNotifications.unshift({
        id: `notif-ca-dir-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        approvalItemId: `apv-ca-${found.id}`,
        referenceNumber: found.advanceNumber,
        documentTitle: `Cash Advance: ${found.activityTitle}`,
        categoryCode: "cash_advance",
        categoryLabel: "Cash Advance Request",
        eventType: action === "approve" ? "FINAL_COMPLETED" : "REJECTED",
        message: action === "approve" ? `[Disetujui Direktur \xB7 Siap Dicairkan Finance] Cash Advance "${found.activityTitle}" (${found.advanceNumber}) sebesar ${formattedAmt} telah disetujui oleh Direktur (${currentUser.name}). Selanjutnya Finance akan mencairkan dana ke rekening pengaju (${found.requesterName} \u2014 ${found.bankName} ${found.bankAccountNumber}).` : `[Cash Advance Request] "${found.activityTitle}" (${found.advanceNumber}) ditolak oleh Direktur (${currentUser.name}): "${found.signatures.approvedBy?.notes || ""}"`,
        targetUserIds: action === "approve" ? Array.from(/* @__PURE__ */ new Set([...reqTargets, ...financeUserIds])) : reqTargets,
        targetRoleCodes: action === "approve" ? ["R", "A2"] : ["R"],
        createdAt: nowIso,
        isReadByUserIds: []
      });
      draft.auditLogs.unshift({
        id: `log-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: `Persetujuan Direktur Kasbon: ${action}`,
        entityType: "TOR",
        entityId: found.torId,
        details: `Direktur ${action === "approve" ? "menyetujui" : "menolak"} otorisasi kasbon ${found.advanceNumber}.`,
        timestamp: nowIso
      });
    });
    if (!record) return res.status(404).json({ error: "Cash Advance tidak ditemukan" });
    res.json(record);
  });
  app.post("/api/cash-advances/:id/disburse", (req, res) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== "finance" && currentUser.role !== "admin") {
      return res.status(403).json({
        error: "Akses ditolak: Hanya Finance yang berwenang mencairkan dana Cash Advance."
      });
    }
    const { transferReference, bankSource } = req.body;
    const now = /* @__PURE__ */ new Date();
    const nowIso = now.toISOString();
    let record = null;
    let errMsg = null;
    db.update((draft) => {
      if (!draft.cashAdvances) return;
      const found = draft.cashAdvances.find((c) => c.id === id);
      if (!found) return;
      if (found.status !== "Disetujui" && found.status !== "Dicairkan") {
        errMsg = `Cash Advance harus berstatus 'Disetujui' oleh Direktur sebelum dapat dicairkan oleh Finance (status saat ini: ${found.status}).`;
        return;
      }
      found.status = "Dicairkan";
      found.signatures.disbursedBy = {
        name: currentUser.name,
        date: nowIso.slice(0, 10),
        transferReference: transferReference || `TRF-WIJNA-${Date.now().toString().slice(-6)}`,
        bankSource: bankSource || "Bank Mandiri Operasional Yayasan",
        isDisbursed: true
      };
      found.updatedAt = nowIso;
      record = found;
      syncTorBudgetInDraft(draft, found.torId);
      syncApprovalHubData(draft);
      const hubItem = draft.approvalHubItems?.[`apv-ca-${found.id}`];
      const parentTor = (draft.tors || []).find((t) => t.id === found.torId);
      const reqTargets = Array.from(
        new Set(
          [
            found.requesterId,
            parentTor?.picId,
            parentTor?.createdById,
            hubItem?.responsibleUserId
          ].filter((id2) => Boolean(id2))
        )
      );
      const formattedAmt = new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0
      }).format(found.totalAmount);
      if (hubItem) {
        hubItem.previewData = {
          ...hubItem.previewData,
          isDisbursed: true,
          disbursedByName: found.signatures.disbursedBy.name,
          disbursedAt: found.signatures.disbursedBy.date,
          transferReference: found.signatures.disbursedBy.transferReference,
          bankSource: found.signatures.disbursedBy.bankSource
        };
        hubItem.updatedAt = nowIso;
        hubItem.timeline = hubItem.timeline || [];
        hubItem.timeline.unshift({
          id: `tl-ca-disb-${found.id}-${Date.now()}`,
          timestamp: nowIso,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRoleCode: "A2",
          actorRoleTitle: currentUser.roleTitle || "Kasir / Finance Officer",
          responsibleName: found.requesterName,
          actionLabel: "Mencairkan Dana Cash Advance ke Pengaju (Finance)",
          resultingStatus: "Approved",
          comment: `Dana sebesar ${formattedAmt} telah dicairkan oleh ${currentUser.name} ke rekening pengaju ${found.bankName} (${found.bankAccountNumber} a.n. ${found.bankAccountHolder}). Ref Transfer: ${found.signatures.disbursedBy.transferReference} (${found.signatures.disbursedBy.bankSource}).`,
          version: hubItem.version || 1
        });
      }
      if (!draft.approvalNotifications) draft.approvalNotifications = [];
      draft.approvalNotifications.unshift({
        id: `notif-ca-disb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        approvalItemId: `apv-ca-${found.id}`,
        referenceNumber: found.advanceNumber,
        documentTitle: `Cash Advance: ${found.activityTitle}`,
        categoryCode: "cash_advance",
        categoryLabel: "Cash Advance Request",
        eventType: "FINAL_COMPLETED",
        message: `[Dana Telah Dicairkan \xB7 Cash Advance] Dana sebesar ${formattedAmt} untuk "${found.activityTitle}" (${found.advanceNumber}) telah dicairkan oleh Finance (${currentUser.name}) ke rekening pengaju (${found.bankName} \xB7 ${found.bankAccountNumber} a.n. ${found.bankAccountHolder}). Ref Transfer: ${found.signatures.disbursedBy.transferReference}.`,
        targetUserIds: reqTargets,
        targetRoleCodes: ["R"],
        createdAt: nowIso,
        isReadByUserIds: []
      });
      draft.auditLogs.unshift({
        id: `log-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: "Pencairan Kasbon (Disbursement)",
        entityType: "TOR",
        entityId: found.torId,
        details: `Dana kasbon ${found.advanceNumber} sebesar ${formattedAmt} telah ditransfer kepada pengaju (${found.requesterName}). Ref: ${found.signatures.disbursedBy.transferReference}`,
        timestamp: nowIso
      });
    });
    if (errMsg) return res.status(400).json({ error: errMsg });
    if (!record) return res.status(404).json({ error: "Cash Advance tidak ditemukan" });
    res.json(record);
  });
  app.delete("/api/cash-advances/:id", (req, res) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);
    let deleted = false;
    let errMsg = null;
    db.update((draft) => {
      if (!draft.cashAdvances) return;
      const idx = draft.cashAdvances.findIndex((c) => c.id === id);
      if (idx !== -1) {
        const item = draft.cashAdvances[idx];
        if (item.status !== "Draft" && currentUser.role !== "director") {
          errMsg = `Cash Advance berstatus '${item.status}' tidak dapat dihapus (hanya draf yang dapat dihapus).`;
          return;
        }
        if (item.requesterId !== currentUser.id && currentUser.role !== "finance" && currentUser.role !== "director") {
          errMsg = "Hanya pembuat pengajuan, Finance, atau Direktur yang dapat menghapus draf Cash Advance.";
          return;
        }
        draft.cashAdvances.splice(idx, 1);
        deleted = true;
        syncTorBudgetInDraft(draft, item.torId);
        draft.auditLogs.unshift({
          id: `log-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: "Penghapusan Draf Kasbon",
          entityType: "TOR",
          entityId: item.torId,
          details: `Draf kasbon ${item.advanceNumber} telah dihapus.`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    });
    if (errMsg) return res.status(403).json({ error: errMsg });
    if (!deleted) return res.status(404).json({ error: "Cash Advance tidak ditemukan" });
    res.json({ message: "Draf Cash Advance berhasil dihapus" });
  });
  app.get("/api/stats", (req, res) => {
    const currentUser = getCurrentUser(req);
    db.update((draft) => {
      syncApprovalHubData(draft);
    });
    const data = db.getData();
    let tors = [...data.tors];
    if (currentUser.role === "staff" && !currentUser.permissions?.canViewAllTors) {
      tors = tors.filter((t) => t.picId === currentUser.id || t.createdById === currentUser.id);
    }
    const now = /* @__PURE__ */ new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const todayMs = new Date(todayStr).getTime();
    let activeTors = 0;
    let nearDeadline = 0;
    let overdue = 0;
    tors.forEach((t) => {
      if (t.activityStatus === "Sedang Berjalan" || t.submissionStatus === "Disetujui") {
        activeTors++;
      }
      if (t.reportingDeadline) {
        const deadMs = new Date(t.reportingDeadline).getTime();
        const diffDays = Math.ceil((deadMs - todayMs) / (1e3 * 60 * 60 * 24));
        if (diffDays < 0 && t.activityStatus !== "Selesai") {
          overdue++;
        } else if (diffDays >= 0 && diffDays <= 3 && t.activityStatus !== "Selesai") {
          nearDeadline++;
        }
      }
    });
    const allItems = Object.values(data.approvalHubItems || {});
    const access = resolveUserApprovalAccess(data, currentUser, allItems);
    const visibleItems = filterApprovalItemsForUser(allItems, currentUser, access);
    const pendingApprovals = visibleItems.filter((item) => {
      if (access.isDirector && item.previewData?.editRequestStatus === "pending") return true;
      if (item.groupType === "program_documents" && access.isA1 && item.accountableProgramUserId === currentUser.id && item.status === "Pending Verification") {
        return true;
      }
      if (item.groupType === "financial_documents" && access.isA2 && item.accountableFinanceUserId === currentUser.id && item.status === "Pending Verification") {
        return true;
      }
      if (access.isDirector && item.status === "Pending Approval") return true;
      return false;
    }).length;
    res.json({
      activeTors,
      pendingApprovals,
      nearDeadline,
      overdue
    });
  });
  app.get("/api/audit-logs", (req, res) => {
    const currentUser = getCurrentUser(req);
    const data = db.getData();
    const canViewGlobalAudit = currentUser.role === "admin" || currentUser.role === "director" || currentUser.role === "finance" || currentUser.role === "program_manager" || currentUser.role === "meal" || Boolean(currentUser.permissions?.canViewAllTors);
    if (!canViewGlobalAudit) {
      return res.json((data.auditLogs || []).filter((log) => log.actorId === currentUser.id));
    }
    res.json(data.auditLogs);
  });
  app.get("/api/cash-advance-summaries/:torId", (req, res) => {
    const { torId } = req.params;
    const data = db.getData();
    const summary = data.cashAdvanceSummaries?.[torId] || null;
    const auditLogs = data.cashAdvanceAuditLogs?.[torId] || [];
    res.json({ summary, auditLogs });
  });
  app.post("/api/cash-advance-summaries/:torId", (req, res) => {
    const { torId } = req.params;
    const { summaryRows, reportDate, note, actionType } = req.body;
    const currentUser = getCurrentUser(req);
    const now = /* @__PURE__ */ new Date();
    const totalAdvance = (summaryRows || []).reduce((acc, r) => acc + (Number(r.advanceAmount) || 0), 0);
    const totalSpent = (summaryRows || []).reduce((acc, r) => acc + (Number(r.actualSpent) || 0), 0);
    const totalRemaining = (summaryRows || []).reduce(
      (acc, r) => acc + Math.max(0, (Number(r.advanceAmount) || 0) - (Number(r.actualSpent) || 0)),
      0
    );
    const totalShortage = (summaryRows || []).reduce(
      (acc, r) => acc + Math.max(0, (Number(r.actualSpent) || 0) - (Number(r.advanceAmount) || 0)),
      0
    );
    const percentUsed = totalAdvance > 0 ? Math.round(totalSpent / totalAdvance * 100) : 0;
    const existingSummary = db.getData().cashAdvanceSummaries?.[torId] || {};
    const summaryRecord = {
      ...existingSummary,
      torId,
      summaryRows,
      reportDate: reportDate || now.toISOString().slice(0, 10),
      totalAdvance,
      totalSpent,
      totalRemaining,
      totalShortage,
      percentUsed,
      updatedAt: now.toISOString(),
      updatedBy: currentUser.name,
      updatedByRole: currentUser.role
    };
    const auditEntry = {
      id: `audit-sum-${Date.now()}`,
      torId,
      timestamp: now.toISOString(),
      actorId: currentUser.id,
      actorName: currentUser.name,
      actorRole: currentUser.role,
      action: actionType || "Pembaruan Ringkasan Realisasi Belanja",
      details: note || `Pembaruan realisasi belanja Cash Advance: Total Uang Muka Rp ${totalAdvance.toLocaleString("id-ID")}, Realisasi Belanja Rp ${totalSpent.toLocaleString("id-ID")}, Akumulasi Sisa Rp ${totalRemaining.toLocaleString("id-ID")}, Akumulasi Kekurangan Rp ${totalShortage.toLocaleString("id-ID")} (${percentUsed}%).`,
      totalAdvance,
      totalSpent,
      totalRemaining,
      totalShortage,
      percentUsed,
      itemCount: (summaryRows || []).length
    };
    db.update((draft) => {
      if (!draft.cashAdvanceSummaries) {
        draft.cashAdvanceSummaries = {};
      }
      draft.cashAdvanceSummaries[torId] = summaryRecord;
      if (!draft.cashAdvanceAuditLogs) {
        draft.cashAdvanceAuditLogs = {};
      }
      if (!draft.cashAdvanceAuditLogs[torId]) {
        draft.cashAdvanceAuditLogs[torId] = [];
      }
      draft.cashAdvanceAuditLogs[torId].unshift(auditEntry);
      draft.auditLogs.unshift({
        id: `log-ca-sum-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.role,
        action: "Pembaruan Ringkasan Realisasi Cash Advance",
        entityType: "TOR",
        entityId: torId,
        details: auditEntry.details,
        timestamp: now.toISOString()
      });
    });
    res.json({
      success: true,
      message: "Ringkasan Cash Advance berhasil diperbarui dan dicatat ke Audit Trail terpisah.",
      summary: summaryRecord,
      auditLog: auditEntry,
      auditLogs: db.getData().cashAdvanceAuditLogs?.[torId] || []
    });
  });
  app.post("/api/cash-advance-summaries/:torId/approve", (req, res) => {
    const { torId } = req.params;
    const { stage, notes } = req.body;
    const currentUser = getCurrentUser(req);
    const now = /* @__PURE__ */ new Date();
    let updatedSummary = null;
    db.update((draft) => {
      if (!draft.cashAdvanceSummaries) draft.cashAdvanceSummaries = {};
      const existing = draft.cashAdvanceSummaries[torId] || {
        torId,
        summaryRows: [],
        reportDate: now.toISOString().slice(0, 10),
        totalAdvance: 0,
        totalSpent: 0,
        totalRemaining: 0,
        totalShortage: 0,
        percentUsed: 0
      };
      const targetTor = (draft.tors || []).find((t) => t.id === torId);
      const defaultReporter = targetTor?.picName || targetTor?.createdByName || currentUser.name;
      if (stage === "finance" && currentUser.role !== "finance" && currentUser.role !== "admin") {
        return;
      }
      if (stage === "director" && currentUser.role !== "director" && currentUser.role !== "admin") {
        return;
      }
      if (stage === "report") {
        existing.summaryApprovalStatus = "Menunggu Pemeriksaan Finance";
        existing.summaryReportedByName = defaultReporter;
        existing.summaryReportedAt = now.toISOString();
        (draft.cashAdvances || []).forEach((ca) => {
          if (ca.torId === torId && ca.status !== "Ditolak") {
            ca.isReported = true;
            ca.reportedByName = ca.reportedByName || defaultReporter;
            ca.reportedAt = ca.reportedAt || now.toISOString();
            if (!ca.reportApprovalStatus) {
              ca.reportApprovalStatus = "Menunggu Pemeriksaan Finance";
            }
          }
        });
      } else if (stage === "finance") {
        if (!existing.summaryReportedByName) {
          existing.summaryReportedByName = defaultReporter;
          existing.summaryReportedAt = now.toISOString();
        }
        existing.summaryApprovalStatus = "Menunggu Persetujuan Director";
        existing.summaryVerifiedByName = currentUser.name;
        existing.summaryVerifiedAt = now.toISOString();
        (draft.cashAdvances || []).forEach((ca) => {
          if (ca.torId === torId && ca.status !== "Ditolak" && ca.isReported) {
            ca.reportVerifiedByName = existing.summaryVerifiedByName;
            ca.reportVerifiedAt = ca.reportVerifiedAt || now.toISOString();
            if (ca.reportApprovalStatus !== "Telah Disetujui") {
              ca.reportApprovalStatus = "Menunggu Persetujuan Director";
            }
          }
        });
      } else if (stage === "director") {
        if (!existing.summaryReportedByName) {
          existing.summaryReportedByName = defaultReporter;
          existing.summaryReportedAt = now.toISOString();
        }
        if (!existing.summaryVerifiedByName) {
          existing.summaryVerifiedByName = currentUser.name;
          existing.summaryVerifiedAt = now.toISOString();
        }
        existing.summaryApprovalStatus = "Telah Disetujui";
        existing.summaryApprovedByName = currentUser.name;
        existing.summaryApprovedAt = now.toISOString();
        (draft.cashAdvances || []).forEach((ca) => {
          if (ca.torId === torId && ca.status !== "Ditolak" && ca.isReported) {
            ca.reportVerifiedByName = ca.reportVerifiedByName || existing.summaryVerifiedByName;
            ca.reportVerifiedAt = ca.reportVerifiedAt || now.toISOString();
            ca.reportApprovedByName = existing.summaryApprovedByName;
            ca.reportApprovedAt = ca.reportApprovedAt || now.toISOString();
            ca.reportApprovalStatus = "Telah Disetujui";
          }
        });
      }
      existing.updatedAt = now.toISOString();
      draft.cashAdvanceSummaries[torId] = existing;
      updatedSummary = existing;
      if (!draft.cashAdvanceAuditLogs) draft.cashAdvanceAuditLogs = {};
      if (!draft.cashAdvanceAuditLogs[torId]) draft.cashAdvanceAuditLogs[torId] = [];
      const labelMap = {
        report: "Pelaporan Ringkasan Akhir oleh Pemohon",
        finance: "Pemeriksaan & Persetujuan Finance pada Ringkasan Akhir",
        director: "Persetujuan Akhir Director pada Ringkasan Akhir"
      };
      draft.cashAdvanceAuditLogs[torId].unshift({
        id: `audit-sum-app-${Date.now()}`,
        torId,
        timestamp: now.toISOString(),
        actorId: currentUser.id,
        actorName: stage === "finance" ? existing.summaryVerifiedByName : stage === "director" ? existing.summaryApprovedByName : existing.summaryReportedByName,
        actorRole: stage === "finance" ? "Finance & Compliance" : stage === "director" ? "Executive Director" : "Pemohon / Pelaksana Kegiatan",
        action: labelMap[stage] || "Persetujuan Ringkasan Akhir",
        details: notes || `Ringkasan Akhir telah diproses pada tahap ${labelMap[stage] || stage}. Status saat ini: ${existing.summaryApprovalStatus}.`,
        totalAdvance: existing.totalAdvance || 0,
        totalSpent: existing.totalSpent || 0,
        totalRemaining: existing.totalRemaining || 0,
        totalShortage: existing.totalShortage || 0,
        percentUsed: existing.percentUsed || 0,
        itemCount: (existing.summaryRows || []).length
      });
    });
    res.json({
      success: true,
      summary: updatedSummary,
      auditLogs: db.getData().cashAdvanceAuditLogs?.[torId] || []
    });
  });
  app.get("/api/meeting-minutes", (req, res) => {
    const data = db.getData();
    const list = [...data.meetingMinutes || []];
    const { torId } = req.query;
    const filtered = torId && typeof torId === "string" && torId !== "all" ? list.filter((m) => m.torId === torId) : list;
    filtered.sort((a, b) => (b.meetingDate || b.createdAt).localeCompare(a.meetingDate || a.createdAt));
    res.json(filtered);
  });
  app.post("/api/meeting-minutes", (req, res) => {
    const currentUser = getCurrentUser(req);
    const now = /* @__PURE__ */ new Date();
    const body = req.body || {};
    let createdRecord = null;
    db.update((draft) => {
      if (!draft.meetingMinutes) draft.meetingMinutes = [];
      const torMinutesCount = body.torId ? draft.meetingMinutes.filter((m) => m.torId === body.torId).length : draft.meetingMinutes.length;
      const seqNum = torMinutesCount + 1;
      const seqStr = String(seqNum).padStart(3, "0");
      const dateStr = body.meetingDate || now.toISOString().slice(0, 10);
      const parsedDate = new Date(dateStr);
      const monthIdx = !isNaN(parsedDate.getTime()) ? parsedDate.getMonth() : now.getMonth();
      const yearNum = !isNaN(parsedDate.getTime()) ? parsedDate.getFullYear() : now.getFullYear();
      const romanMonths = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
      const romanMonth = romanMonths[monthIdx] || "X";
      const linkedTor = body.torId ? (draft.tors || []).find((t) => t.id === body.torId) : null;
      const notulenTitle = (body.title || "").trim() || linkedTor?.title || "Notulen Rapat";
      const autoDocNumber = body.documentNumber && String(body.documentNumber).trim() ? String(body.documentNumber).trim() : `${seqStr}/MOM/WIJNA/${romanMonth}/${yearNum}`;
      const newMom = {
        id: `mom-${Date.now()}`,
        documentNumber: autoDocNumber,
        torId: body.torId || void 0,
        torNumber: body.torNumber || linkedTor?.torNumber || void 0,
        title: notulenTitle,
        implementationProject: body.implementationProject || "",
        partnerOrganization: body.partnerOrganization || "",
        meetingDate: dateStr,
        startTime: body.startTime || "09:00",
        endTime: body.endTime || "11:00",
        meetingLocation: body.meetingLocation || "",
        meetingRoomPlatform: body.meetingRoomPlatform || "",
        participants: Array.isArray(body.participants) ? body.participants : [],
        recorderName: body.recorderName ?? "",
        discussions: Array.isArray(body.discussions) ? body.discussions : [],
        decisions: Array.isArray(body.decisions) ? body.decisions : [],
        actionPoints: Array.isArray(body.actionPoints) ? body.actionPoints : [],
        additionalNotes: body.additionalNotes || "",
        nextMeetingAgenda: body.nextMeetingAgenda || "",
        nextMeetingSchedule: body.nextMeetingSchedule || "",
        preparationDocuments: body.preparationDocuments || "",
        partnerInstitution: body.partnerInstitution || "",
        partnerRepName: body.partnerRepName || "",
        partnerRepTitle: body.partnerRepTitle || "",
        createdById: currentUser.id,
        createdByName: currentUser.name,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      };
      draft.meetingMinutes.unshift(newMom);
      createdRecord = newMom;
      draft.auditLogs.unshift({
        id: `log-mom-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.role,
        action: "Pembuatan Notulen Rapat",
        entityType: "TOR",
        entityId: newMom.torId || newMom.id,
        details: `Membuat dokumen notulen ${newMom.documentNumber} \u2014 "${newMom.title}"`,
        timestamp: now.toISOString()
      });
    });
    res.status(201).json(createdRecord);
  });
  app.put("/api/meeting-minutes/:id", (req, res) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);
    const now = /* @__PURE__ */ new Date();
    const body = req.body || {};
    let updatedRecord = null;
    db.update((draft) => {
      if (!draft.meetingMinutes) draft.meetingMinutes = [];
      const idx = draft.meetingMinutes.findIndex((m) => m.id === id);
      if (idx === -1) return;
      const existing = draft.meetingMinutes[idx];
      const merged = {
        ...existing,
        documentNumber: body.documentNumber ?? existing.documentNumber,
        torId: body.torId ?? existing.torId,
        torNumber: body.torNumber ?? existing.torNumber,
        title: body.title ?? existing.title,
        implementationProject: body.implementationProject ?? existing.implementationProject,
        partnerOrganization: body.partnerOrganization ?? existing.partnerOrganization,
        meetingDate: body.meetingDate ?? existing.meetingDate,
        startTime: body.startTime ?? existing.startTime,
        endTime: body.endTime ?? existing.endTime,
        meetingLocation: body.meetingLocation ?? existing.meetingLocation,
        meetingRoomPlatform: body.meetingRoomPlatform ?? existing.meetingRoomPlatform,
        participants: Array.isArray(body.participants) ? body.participants : existing.participants,
        recorderName: body.recorderName ?? existing.recorderName,
        discussions: Array.isArray(body.discussions) ? body.discussions : existing.discussions,
        decisions: Array.isArray(body.decisions) ? body.decisions : existing.decisions,
        actionPoints: Array.isArray(body.actionPoints) ? body.actionPoints : existing.actionPoints,
        additionalNotes: body.additionalNotes ?? existing.additionalNotes,
        nextMeetingAgenda: body.nextMeetingAgenda ?? existing.nextMeetingAgenda,
        nextMeetingSchedule: body.nextMeetingSchedule ?? existing.nextMeetingSchedule,
        preparationDocuments: body.preparationDocuments ?? existing.preparationDocuments,
        partnerInstitution: body.partnerInstitution ?? existing.partnerInstitution,
        partnerRepName: body.partnerRepName ?? existing.partnerRepName,
        partnerRepTitle: body.partnerRepTitle ?? existing.partnerRepTitle,
        updatedAt: now.toISOString()
      };
      draft.meetingMinutes[idx] = merged;
      updatedRecord = merged;
      draft.auditLogs.unshift({
        id: `log-mom-upd-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.role,
        action: "Pembaruan Notulen Rapat",
        entityType: "TOR",
        entityId: merged.torId || merged.id,
        details: `Memperbarui dokumen notulen ${merged.documentNumber} \u2014 "${merged.title}"`,
        timestamp: now.toISOString()
      });
    });
    if (!updatedRecord) {
      return res.status(404).json({ error: "Notulen tidak ditemukan" });
    }
    res.json(updatedRecord);
  });
  app.delete("/api/meeting-minutes/:id", (req, res) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const data = db.getData();
    const target = (data.meetingMinutes || []).find((m) => m.id === id);
    if (!target) {
      return res.status(404).json({ error: "Notulen tidak ditemukan" });
    }
    if (target.createdById && target.createdById !== currentUser.id && currentUser.role !== "director" && currentUser.role !== "program_manager" && currentUser.role !== "meal" && currentUser.role !== "admin") {
      return res.status(403).json({
        error: "Akses ditolak: Hanya pembuat notulen, Program Manager, MEAL, atau Direktur yang dapat menghapus notulen ini."
      });
    }
    db.update((draft) => {
      if (!draft.meetingMinutes) return;
      draft.meetingMinutes = draft.meetingMinutes.filter((m) => m.id !== id);
      draft.auditLogs.unshift({
        id: `log-mom-del-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: "Penghapusan Notulen Rapat",
        entityType: "TOR",
        entityId: target.torId || id,
        details: `Menghapus dokumen notulen ${target.documentNumber} \u2014 "${target.title}".`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    });
    res.json({ message: "Notulen berhasil dihapus" });
  });
  app.get("/api/documentation-list/:torId", (req, res) => {
    const { torId } = req.params;
    const data = db.getData();
    const listFromArr = (data.activityDocumentationList || []).filter((d) => d.torId === torId);
    if (listFromArr.length > 0) {
      return res.json(listFromArr);
    }
    const single = data.activityDocumentations?.[torId] || data.tors.find((t) => t.id === torId)?.documentation;
    if (single && single.bestPhotosStoryTopic) {
      return res.json([
        {
          ...single,
          documentNumber: single.documentNumber || "001/DOC/WIJNA/X/2026"
        }
      ]);
    }
    return res.json([]);
  });
  app.post("/api/documentation-list/:torId", (req, res) => {
    const { torId } = req.params;
    const currentUser = getCurrentUser(req);
    const now = /* @__PURE__ */ new Date();
    const nowIso = now.toISOString();
    const body = req.body || {};
    let savedRecord = null;
    db.update((draft) => {
      if (!draft.activityDocumentations) draft.activityDocumentations = {};
      if (!Array.isArray(draft.activityDocumentationList)) draft.activityDocumentationList = [];
      const torIdx = draft.tors.findIndex((t) => t.id === torId);
      const tor = torIdx >= 0 ? draft.tors[torIdx] : void 0;
      const existingIdx = body.id ? draft.activityDocumentationList.findIndex((d) => d.id === body.id) : -1;
      const prev = existingIdx >= 0 ? draft.activityDocumentationList[existingIdx] : void 0;
      const romanMonths = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
      const romanMonth = romanMonths[now.getMonth()] || "X";
      const yearNum = now.getFullYear();
      const seqNum = draft.activityDocumentationList.length + 1;
      const autoDocNumber = body.documentNumber && String(body.documentNumber).trim() ? String(body.documentNumber).trim() : prev?.documentNumber || `${String(seqNum).padStart(3, "0")}/DOC/WIJNA/${romanMonth}/${yearNum}`;
      const bestPhotos = [1, 2, 3, 4, 5].map((slotNum, idx) => {
        const incoming = Array.isArray(body.bestPhotos) ? body.bestPhotos.find((p) => Number(p.slotNumber) === slotNum) || body.bestPhotos[idx] : void 0;
        const fallback = prev?.bestPhotos?.[idx];
        return {
          slotNumber: slotNum,
          photoNameTitle: String(incoming?.photoNameTitle ?? fallback?.photoNameTitle ?? ""),
          photoLink: String(incoming?.photoLink ?? fallback?.photoLink ?? ""),
          photoLocation: String(
            incoming?.photoLocation ?? fallback?.photoLocation ?? tor?.location ?? ""
          ),
          photographer: String(incoming?.photographer ?? fallback?.photographer ?? "")
        };
      });
      const rawStories = Array.isArray(body.humanInterestStories) ? body.humanInterestStories : prev?.humanInterestStories || [];
      const humanInterestStories = rawStories.map((s, idx) => ({
        id: s.id || `his-${Date.now()}-${idx + 1}`,
        storyTitle: String(s.storyTitle ?? ""),
        storyLink: String(s.storyLink ?? "")
      })).filter((s) => s.storyTitle.trim() !== "" || s.storyLink.trim() !== "");
      const rawGeneralLinks = Array.isArray(body.generalPhotoLinks) ? body.generalPhotoLinks : prev?.generalPhotoLinks || [];
      const generalPhotoLinks = rawGeneralLinks.length > 0 ? rawGeneralLinks.map((g, idx) => ({
        id: g.id || `gpl-${Date.now()}-${idx + 1}`,
        url: String(g.url ?? "")
      })) : [
        {
          id: `gpl-${Date.now()}-1`,
          url: ""
        }
      ];
      const nextDoc = {
        id: prev?.id || body.id || `doc-act-${torId}-${Date.now()}`,
        documentNumber: autoDocNumber,
        torId,
        torNumber: body.torNumber || tor?.torNumber || prev?.torNumber || "",
        programId: body.programId || tor?.programId || prev?.programId || "",
        programName: body.programName || tor?.programName || prev?.programName || "",
        activityTitle: body.activityTitle || tor?.title || prev?.activityTitle || "",
        bestPhotosStoryTopic: String(
          body.bestPhotosStoryTopic ?? prev?.bestPhotosStoryTopic ?? ""
        ),
        bestPhotos,
        humanInterestStories,
        generalPhotoLinks,
        updatedById: currentUser.id,
        updatedByName: currentUser.name,
        createdAt: prev?.createdAt || nowIso,
        updatedAt: nowIso
      };
      if (existingIdx >= 0) {
        draft.activityDocumentationList[existingIdx] = nextDoc;
      } else {
        draft.activityDocumentationList.unshift(nextDoc);
      }
      draft.activityDocumentations[torId] = nextDoc;
      if (torIdx >= 0) {
        draft.tors[torIdx] = {
          ...draft.tors[torIdx],
          documentation: nextDoc,
          updatedAt: nowIso
        };
      }
      savedRecord = nextDoc;
      draft.auditLogs.unshift({
        id: `log-doc-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: existingIdx >= 0 ? "Pembaruan Dokumentasi Kegiatan" : "Pembuatan Dokumentasi Kegiatan",
        entityType: "TOR",
        entityId: torId,
        details: `Menyimpan paket dokumentasi ${nextDoc.documentNumber} \u2014 Topik Cerita: "${nextDoc.bestPhotosStoryTopic || "-"}" untuk ${nextDoc.torNumber || torId}.`,
        timestamp: nowIso
      });
    });
    res.json(savedRecord);
  });
  app.delete("/api/documentation-list/:id", (req, res) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const data = db.getData();
    const target = (data.activityDocumentationList || []).find((d) => d.id === id);
    if (!target) {
      return res.status(404).json({ error: "Dokumentasi kegiatan tidak ditemukan" });
    }
    if (target.updatedById && target.updatedById !== currentUser.id && currentUser.role !== "director" && currentUser.role !== "program_manager" && currentUser.role !== "meal" && currentUser.role !== "admin") {
      return res.status(403).json({
        error: "Akses ditolak: Hanya pembuat dokumentasi, Program Manager, MEAL, atau Direktur yang dapat menghapus paket dokumentasi ini."
      });
    }
    db.update((draft) => {
      if (!Array.isArray(draft.activityDocumentationList)) return;
      draft.activityDocumentationList = draft.activityDocumentationList.filter((d) => d.id !== id);
      draft.auditLogs.unshift({
        id: `log-doc-del-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: "Penghapusan Dokumentasi Kegiatan",
        entityType: "TOR",
        entityId: target.torId || id,
        details: `Menghapus paket dokumentasi ${target.documentNumber} (${target.activityTitle || id}).`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    });
    res.json({ message: "Dokumentasi kegiatan berhasil dihapus" });
  });
  app.get("/api/documentations/:torId", (req, res) => {
    const { torId } = req.params;
    const data = db.getData();
    const tor = data.tors.find((t) => t.id === torId);
    const existing = (data.activityDocumentationList || []).find((d) => d.torId === torId) || data.activityDocumentations?.[torId] || tor?.documentation;
    if (existing) {
      return res.json(existing);
    }
    const defaultSlots = [1, 2, 3, 4, 5].map((slotNumber) => ({
      slotNumber,
      photoNameTitle: "",
      photoLink: "",
      photoLocation: tor?.location || "",
      photographer: ""
    }));
    const defaultDoc = {
      id: `doc-act-${torId}`,
      documentNumber: "001/DOC/WIJNA/X/2026",
      torId,
      torNumber: tor?.torNumber || "",
      programId: tor?.programId || "",
      programName: tor?.programName || "",
      activityTitle: tor?.title || "",
      bestPhotosStoryTopic: "",
      bestPhotos: defaultSlots,
      humanInterestStories: [],
      generalPhotoLinks: [
        {
          id: `gpl-${Date.now()}-1`,
          url: ""
        }
      ],
      updatedById: data.currentUserId || "user-staff-1",
      updatedByName: tor?.picName || "Staff WIJNA",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    res.json(defaultDoc);
  });
  app.post("/api/documentations/:torId", (req, res) => {
    const { torId } = req.params;
    const currentUser = getCurrentUser(req);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const body = req.body || {};
    let savedRecord = null;
    db.update((draft) => {
      if (!draft.activityDocumentations) draft.activityDocumentations = {};
      if (!Array.isArray(draft.activityDocumentationList)) draft.activityDocumentationList = [];
      const torIdx = draft.tors.findIndex((t) => t.id === torId);
      const tor = torIdx >= 0 ? draft.tors[torIdx] : void 0;
      const prev = draft.activityDocumentations[torId] || tor?.documentation;
      const bestPhotos = [1, 2, 3, 4, 5].map((slotNum, idx) => {
        const incoming = Array.isArray(body.bestPhotos) ? body.bestPhotos.find((p) => Number(p.slotNumber) === slotNum) || body.bestPhotos[idx] : void 0;
        const fallback = prev?.bestPhotos?.[idx];
        return {
          slotNumber: slotNum,
          photoNameTitle: String(incoming?.photoNameTitle ?? fallback?.photoNameTitle ?? ""),
          photoLink: String(incoming?.photoLink ?? fallback?.photoLink ?? ""),
          photoLocation: String(incoming?.photoLocation ?? fallback?.photoLocation ?? tor?.location ?? ""),
          photographer: String(incoming?.photographer ?? fallback?.photographer ?? "")
        };
      });
      const rawStories = Array.isArray(body.humanInterestStories) ? body.humanInterestStories : prev?.humanInterestStories || [];
      const humanInterestStories = rawStories.map((s, idx) => ({
        id: s.id || `his-${Date.now()}-${idx + 1}`,
        storyTitle: String(s.storyTitle ?? ""),
        storyLink: String(s.storyLink ?? "")
      })).filter((s) => s.storyTitle.trim() !== "" || s.storyLink.trim() !== "");
      const rawGeneralLinks = Array.isArray(body.generalPhotoLinks) ? body.generalPhotoLinks : prev?.generalPhotoLinks || [];
      const generalPhotoLinks = rawGeneralLinks.length > 0 ? rawGeneralLinks.map((g, idx) => ({
        id: g.id || `gpl-${Date.now()}-${idx + 1}`,
        url: String(g.url ?? "")
      })) : [
        {
          id: `gpl-${Date.now()}-1`,
          url: ""
        }
      ];
      const nextDoc = {
        id: prev?.id || `doc-act-${torId}`,
        documentNumber: prev?.documentNumber || "001/DOC/WIJNA/X/2026",
        torId,
        torNumber: body.torNumber || tor?.torNumber || prev?.torNumber || "",
        programId: body.programId || tor?.programId || prev?.programId || "",
        programName: body.programName || tor?.programName || prev?.programName || "",
        activityTitle: body.activityTitle || tor?.title || prev?.activityTitle || "",
        bestPhotosStoryTopic: String(body.bestPhotosStoryTopic ?? prev?.bestPhotosStoryTopic ?? ""),
        bestPhotos,
        humanInterestStories,
        generalPhotoLinks,
        updatedById: currentUser.id,
        updatedByName: currentUser.name,
        createdAt: prev?.createdAt || now,
        updatedAt: now
      };
      draft.activityDocumentations[torId] = nextDoc;
      const listIdx = draft.activityDocumentationList.findIndex((d) => d.id === nextDoc.id);
      if (listIdx >= 0) {
        draft.activityDocumentationList[listIdx] = nextDoc;
      } else {
        draft.activityDocumentationList.unshift(nextDoc);
      }
      if (torIdx >= 0) {
        draft.tors[torIdx] = {
          ...draft.tors[torIdx],
          documentation: nextDoc,
          updatedAt: now
        };
      }
      savedRecord = nextDoc;
    });
    res.json(savedRecord);
  });
  app.get("/api/monitoring-connect", (_req, res) => {
    const data = db.getData();
    res.json({
      outputRaciRecords: data.outputRaciRecords || {},
      activityMonitoringRecords: data.activityMonitoringRecords || {}
    });
  });
  app.post("/api/monitoring-connect/raci/:outputId", (req, res) => {
    const { outputId } = req.params;
    const currentUser = getCurrentUser(req);
    if (currentUser.isActive === false) {
      return res.status(403).json({
        error: "Akun Anda berstatus nonaktif dan tidak dapat mengubah penugasan RACI."
      });
    }
    const canManageRaci = currentUser.role === "program_manager" || currentUser.role === "admin" || Boolean(currentUser.permissions?.canManagePrograms);
    if (!canManageRaci) {
      return res.status(403).json({
        error: "Hanya Program Manager atau pengguna dengan izin Kelola Struktur Program yang dapat mengatur penugasan RACI Output."
      });
    }
    const body = req.body || {};
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const checkData = db.getData();
    const checkResp = body.responsibleUserId ? checkData.users.find((u) => u.id === body.responsibleUserId) : void 0;
    const checkAcc = body.accountableUserId ? checkData.users.find((u) => u.id === body.accountableUserId) : void 0;
    if (body.responsibleUserId && !checkResp) {
      return res.status(400).json({ error: "Pengguna R (Responsible) tidak ditemukan dalam database pengguna." });
    }
    if (body.accountableUserId && !checkAcc) {
      return res.status(400).json({ error: "Pengguna A1 (Accountable Program) tidak ditemukan dalam database pengguna." });
    }
    if (checkResp && checkResp.isActive === false) {
      return res.status(400).json({
        error: `Pengguna "${checkResp.name}" berstatus Nonaktif dan tidak dapat ditugaskan sebagai R (Responsible) baru.`
      });
    }
    if (checkAcc && checkAcc.isActive === false) {
      return res.status(400).json({
        error: `Pengguna "${checkAcc.name}" berstatus Nonaktif dan tidak dapat ditugaskan sebagai A1 (Accountable) baru.`
      });
    }
    let savedRecord = null;
    db.update((draft) => {
      if (!draft.outputRaciRecords) draft.outputRaciRecords = {};
      const outp = draft.outputs.find((o) => o.id === outputId);
      const outc = draft.outcomes.find((oc) => oc.id === outp?.outcomeId);
      const prev = draft.outputRaciRecords[outputId];
      const respUser = draft.users.find((u) => u.id === body.responsibleUserId);
      const accUser = draft.users.find((u) => u.id === body.accountableUserId);
      const finUser = (body.accountableFinanceUserId ? draft.users.find((u) => u.id === body.accountableFinanceUserId && u.isActive !== false) : void 0) || draft.users.find((u) => u.id === prev?.accountableFinanceUserId && u.isActive !== false) || draft.users.find((u) => u.role === "finance" && u.isActive !== false);
      const consultedUsers = Array.isArray(body.consultedUsers) ? Array.from(
        new Set(
          body.consultedUsers.map((c) => String(c || "").trim()).filter(Boolean)
        )
      ) : prev?.consultedUsers || [];
      const informedUsers = Array.isArray(body.informedUsers) ? Array.from(
        new Set(
          body.informedUsers.map((i) => String(i || "").trim()).filter(Boolean)
        )
      ) : prev?.informedUsers || [];
      const hasRA = Boolean(respUser && accUser);
      const isReassignment = Boolean(
        prev && (prev.responsibleUserId !== (respUser?.id || "") || prev.accountableUserId !== (accUser?.id || ""))
      );
      const prevHistory = Array.isArray(prev?.auditHistory) ? [...prev.auditHistory] : [];
      const newAuditEntry = {
        id: `raci-aud-${Date.now()}`,
        timestamp: nowIso,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: isReassignment ? "Pembaruan Penugasan RACI" : "Penugasan RACI Diajukan",
        status: hasRA ? "Menunggu Persetujuan Direktur" : "Menunggu Program Manager",
        notes: `R: ${respUser?.name || "-"} \xB7 A1: ${accUser?.name || "-"}`,
        rName: respUser?.name || "-",
        a1Name: accUser?.name || "-"
      };
      const nextRecord = {
        outputId,
        programId: body.programId || outc?.programId || prev?.programId || "",
        outcomeId: body.outcomeId || outp?.outcomeId || prev?.outcomeId || "",
        responsibleUserId: respUser?.id || "",
        responsibleUserName: respUser?.name || "",
        accountableUserId: accUser?.id || "",
        accountableUserName: accUser?.name || "",
        accountableFinanceUserId: finUser?.id || prev?.accountableFinanceUserId,
        accountableFinanceUserName: finUser?.name || prev?.accountableFinanceUserName,
        consultedUsers,
        informedUsers,
        status: hasRA ? "Menunggu Persetujuan Direktur" : "Menunggu Program Manager",
        assignedById: currentUser.id,
        assignedByName: currentUser.name,
        assignedAt: nowIso,
        approvedById: void 0,
        approvedByName: void 0,
        approvedAt: void 0,
        directorNotes: void 0,
        auditHistory: [newAuditEntry, ...prevHistory],
        updatedAt: nowIso
      };
      draft.outputRaciRecords[outputId] = nextRecord;
      savedRecord = nextRecord;
      if (outp && respUser) {
        outp.picName = respUser.name;
      }
      if (!draft.approvalNotifications) draft.approvalNotifications = [];
      const directorIds = draft.users.filter((u) => u.role === "director" && u.isActive !== false).map((u) => u.id);
      const targetIds = Array.from(
        new Set(
          [
            ...directorIds,
            nextRecord.responsibleUserId,
            nextRecord.accountableUserId,
            currentUser.id
          ].filter(Boolean)
        )
      );
      draft.approvalNotifications.unshift({
        id: `notif-raci-sub-${outputId}-${Date.now()}`,
        approvalItemId: `raci-${outputId}`,
        referenceNumber: `RACI/${outputId.toUpperCase()}`,
        documentTitle: `RACI Output: ${outp?.name || outputId}`,
        categoryCode: "tor",
        categoryLabel: "RACI Output",
        eventType: "ENTER_VERIFICATION",
        message: `${currentUser.name} mengajukan penugasan RACI Output "${outp?.name || outputId}" (R: ${nextRecord.responsibleUserName || "-"}, A1: ${nextRecord.accountableUserName || "-"}) untuk persetujuan Direktur.`,
        targetUserIds: targetIds,
        targetRoleCodes: ["Direktur", "A1", "R"],
        createdAt: nowIso,
        isReadByUserIds: [currentUser.id]
      });
      if (isReassignment && draft.approvalHubItems) {
        const a1Changed = prev?.accountableUserId !== nextRecord.accountableUserId;
        for (const item of Object.values(draft.approvalHubItems)) {
          if (item.outputId !== outputId) continue;
          if (nextRecord.responsibleUserId) {
            item.responsibleUserId = nextRecord.responsibleUserId;
            item.responsibleUserName = nextRecord.responsibleUserName;
          }
          if (nextRecord.accountableUserId) {
            item.accountableProgramUserId = nextRecord.accountableUserId;
            item.accountableProgramUserName = nextRecord.accountableUserName;
          }
          if (a1Changed && item.groupType === "program_documents" && item.status === "Approved") {
            item.status = "Pending Verification";
            item.isLocked = false;
            item.currentStepNumber = 2;
            item.currentActiveRole = "A1";
          }
          item.updatedAt = nowIso;
          item.timeline = item.timeline || [];
          item.timeline.unshift({
            id: `tl-raci-reassign-${item.id}-${Date.now()}`,
            timestamp: nowIso,
            actorId: currentUser.id,
            actorName: currentUser.name,
            actorRoleCode: currentUser.role === "director" ? "Direktur" : "A1",
            actorRoleTitle: currentUser.roleTitle,
            responsibleName: item.responsibleUserName,
            actionLabel: "Perubahan RACI Output \u2014 Memicu Mekanisme Persetujuan Ulang",
            resultingStatus: item.status,
            comment: `Penugasan RACI Output "${outp?.name || outputId}" diperbarui (R: ${nextRecord.responsibleUserName || "-"}, A1: ${nextRecord.accountableUserName || "-"}). Menunggu pengesahan ulang sesuai alur persetujuan.`,
            version: item.version || 1
          });
        }
      }
      draft.auditLogs.unshift({
        id: `log-raci-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: isReassignment ? "Perubahan RACI Output (Memicu Persetujuan Ulang)" : "Penugasan RACI Output (MEAL Connect)",
        entityType: "PROGRAM",
        entityId: outputId,
        details: `Menentukan RACI untuk Output "${outp?.name || outputId}" (R: ${nextRecord.responsibleUserName || "-"}, A: ${nextRecord.accountableUserName || "-"}) \u2014 Status: ${nextRecord.status}.`,
        timestamp: nowIso
      });
    });
    res.json(savedRecord);
  });
  app.post("/api/monitoring-connect/raci/:outputId/approve", (req, res) => {
    const { outputId } = req.params;
    const currentUser = getCurrentUser(req);
    if (currentUser.isActive === false) {
      return res.status(403).json({
        error: "Akun Anda berstatus nonaktif dan tidak dapat memberikan pengesahan RACI."
      });
    }
    if (currentUser.role !== "director") {
      return res.status(403).json({
        error: "Hanya Direktur Eksekutif yang memiliki kewenangan mengesahkan atau meminta revisi penugasan RACI Output."
      });
    }
    const body = req.body || {};
    const decision = body.decision === "revision" ? "revision" : "approve";
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    let savedRecord = null;
    db.update((draft) => {
      if (!draft.outputRaciRecords) draft.outputRaciRecords = {};
      const prev = draft.outputRaciRecords[outputId];
      if (!prev) return;
      const outp = draft.outputs.find((o) => o.id === outputId);
      const notesText = String(body.directorNotes ?? "").trim();
      const prevHistory = Array.isArray(prev.auditHistory) ? [...prev.auditHistory] : [];
      const decisionAuditEntry = {
        id: `raci-aud-${Date.now()}`,
        timestamp: nowIso,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: decision === "approve" ? "Disetujui Direktur (RACI Aktif)" : "Diminta Revisi oleh Direktur",
        status: decision === "approve" ? "Aktif" : "Menunggu Program Manager",
        notes: notesText || (decision === "approve" ? "Penugasan R & A disetujui Direktur." : "Direktur meminta revisi penugasan RACI."),
        rName: prev.responsibleUserName || "-",
        a1Name: prev.accountableUserName || "-"
      };
      const nextRecord = {
        ...prev,
        status: decision === "approve" ? "Aktif" : "Menunggu Program Manager",
        approvedById: decision === "approve" ? currentUser.id : void 0,
        approvedByName: decision === "approve" ? currentUser.name : void 0,
        approvedAt: decision === "approve" ? nowIso : void 0,
        directorNotes: notesText,
        auditHistory: [decisionAuditEntry, ...prevHistory],
        updatedAt: nowIso
      };
      draft.outputRaciRecords[outputId] = nextRecord;
      savedRecord = nextRecord;
      if (!draft.approvalNotifications) draft.approvalNotifications = [];
      const pmIds = draft.users.filter((u) => u.role === "program_manager" && u.isActive !== false).map((u) => u.id);
      const directorIds = draft.users.filter((u) => u.role === "director" && u.isActive !== false).map((u) => u.id);
      const targetIds = Array.from(
        new Set(
          [
            ...pmIds,
            ...directorIds,
            prev.assignedById,
            prev.responsibleUserId,
            prev.accountableUserId
          ].filter((id) => Boolean(id))
        )
      );
      draft.approvalNotifications.unshift({
        id: `notif-raci-${decision}-${outputId}-${Date.now()}`,
        approvalItemId: `raci-${outputId}`,
        referenceNumber: `RACI/${outputId.toUpperCase()}`,
        documentTitle: `RACI Output: ${outp?.name || outputId}`,
        categoryCode: "tor",
        categoryLabel: "RACI Output",
        eventType: decision === "approve" ? "APPROVED" : "REVISION_REQUIRED",
        message: decision === "approve" ? `Direktur (${currentUser.name}) menyetujui penugasan RACI Output "${outp?.name || outputId}" (R: ${prev.responsibleUserName}, A1: ${prev.accountableUserName}).` : `Direktur (${currentUser.name}) meminta revisi penugasan RACI Output "${outp?.name || outputId}"${notesText ? ` \u2014 Catatan: "${notesText}"` : "."}`,
        targetUserIds: targetIds,
        targetRoleCodes: ["A1", "R", "Direktur"],
        createdAt: nowIso,
        isReadByUserIds: [currentUser.id]
      });
      draft.auditLogs.unshift({
        id: `log-raci-app-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: decision === "approve" ? "Persetujuan Direktur RACI Output" : "Permintaan Revisi RACI Output",
        entityType: "PROGRAM",
        entityId: outputId,
        details: `${decision === "approve" ? "Menyetujui" : "Meminta revisi"} penugasan RACI Output "${outp?.name || outputId}" (R: ${prev.responsibleUserName}, A: ${prev.accountableUserName})${notesText ? ` \u2014 Catatan: ${notesText}` : ""}.`,
        timestamp: nowIso
      });
    });
    if (!savedRecord) {
      return res.status(404).json({ error: "Data RACI untuk Output ini belum tersedia." });
    }
    res.json(savedRecord);
  });
  app.post("/api/monitoring-connect/activity/:activityId", (req, res) => {
    const { activityId } = req.params;
    const currentUser = getCurrentUser(req);
    if (currentUser.isActive === false) {
      return res.status(403).json({
        error: "Akun Anda berstatus nonaktif dan tidak dapat mengelola Monitoring Tools."
      });
    }
    const body = req.body || {};
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const currentData = db.getData();
    const targetAct = currentData.activities.find((a) => a.id === activityId);
    const targetOutp = currentData.outputs.find(
      (o) => o.id === (body.outputId || targetAct?.outputId)
    );
    const targetRaci = targetOutp ? currentData.outputRaciRecords?.[targetOutp.id] : void 0;
    if (!targetRaci || targetRaci.status !== "Aktif") {
      return res.status(403).json({
        error: targetRaci?.status === "Menunggu Persetujuan Direktur" ? "Penugasan RACI pada Output ini masih menunggu persetujuan Direktur. Pengelolaan Monitoring Tools belum diizinkan." : "Penugasan RACI pada Output ini belum aktif."
      });
    }
    const isR = targetRaci.responsibleUserId === currentUser.id;
    const isA1 = targetRaci.accountableUserId === currentUser.id;
    const isA2 = currentUser.role === "finance" || (currentUser.roleTitle || "").toLowerCase().includes("finance");
    if (!isR && !isA1 && !isA2) {
      return res.status(403).json({
        error: "Hanya user dengan penugasan R (Responsible), A1 (Accountable Program), atau A2 (Accountable Finance) yang dapat mengelola Monitoring Tools pada Output ini."
      });
    }
    const actorRaciLabel = isR ? "R \u2013 Responsible" : isA1 ? "A1 \u2013 Accountable Program" : "A2 \u2013 Accountable Finance";
    let savedRecord = null;
    db.update((draft) => {
      if (!draft.activityMonitoringRecords) draft.activityMonitoringRecords = {};
      const act = draft.activities.find((a) => a.id === activityId);
      const outp = draft.outputs.find((o) => o.id === act?.outputId);
      const outc = draft.outcomes.find((oc) => oc.id === outp?.outcomeId);
      const rawTools = Array.isArray(body.tools) ? body.tools : [];
      const tools = rawTools.map((t) => ({
        toolId: String(t.toolId || ""),
        toolName: String(t.toolName || ""),
        categoryCode: t.categoryCode || "A",
        categoryName: String(t.categoryName || ""),
        shortFunction: String(t.shortFunction || ""),
        toolUrl: String(t.toolUrl || ""),
        notes: String(t.notes || ""),
        assignedAt: t.assignedAt || nowIso,
        assignedById: t.assignedById || currentUser.id,
        assignedByName: t.assignedByName || currentUser.name
      }));
      const nextRecord = {
        activityId,
        outputId: body.outputId || act?.outputId || "",
        outcomeId: body.outcomeId || outp?.outcomeId || "",
        programId: body.programId || outc?.programId || "",
        tools,
        status: tools.length > 0 ? "Sudah Ada Monitoring" : "Belum Ada Monitoring",
        updatedById: currentUser.id,
        updatedByName: currentUser.name,
        updatedAt: nowIso
      };
      draft.activityMonitoringRecords[activityId] = nextRecord;
      savedRecord = nextRecord;
      draft.auditLogs.unshift({
        id: `log-mon-act-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: "Pembaruan Monitoring Tools Activity",
        entityType: "PROGRAM",
        entityId: activityId,
        details: `Menyimpan ${tools.length} Monitoring Tools untuk Activity "${act?.name || activityId}" oleh ${currentUser.name} [${actorRaciLabel}] \u2014 Status: ${nextRecord.status}.`,
        timestamp: nowIso
      });
    });
    res.json(savedRecord);
  });
  function createEmptyMonitoringSections() {
    return {
      baseline: {
        narrative: "",
        evidenceLinks: [{ id: `ev-a-${Date.now()}`, label: "", url: "" }]
      },
      intervention: {
        narrative: "",
        evidenceLinks: [{ id: `ev-b-${Date.now()}`, label: "", url: "" }]
      },
      results: {
        narrative: "",
        evidenceLinks: [{ id: `ev-c-${Date.now()}`, label: "", url: "" }]
      },
      contextLearning: {
        narrative: "",
        evidenceLinks: [{ id: `ev-d-${Date.now()}`, label: "", url: "" }]
      },
      reflectionLearning: {
        narrative: "",
        evidenceLinks: [{ id: `ev-e-${Date.now()}`, label: "", url: "" }]
      },
      keySuccessParticipation: {
        narrative: "",
        evidenceLinks: [{ id: `ev-f-${Date.now()}`, label: "", url: "" }]
      },
      nextImplementationProposal: {
        narrative: "",
        evidenceLinks: [{ id: `ev-g-${Date.now()}`, label: "", url: "" }]
      }
    };
  }
  function syncMonitoringReportsForTor(draft, targetTorId) {
    if (!draft.monitoringReports || typeof draft.monitoringReports !== "object") {
      draft.monitoringReports = {};
    }
    const torsToSync = targetTorId ? (draft.tors || []).filter((t) => t.id === targetTorId) : draft.tors || [];
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const validIdsForScope = /* @__PURE__ */ new Set();
    for (const tor of torsToSync) {
      const actMon = draft.activityMonitoringRecords?.[tor.activityId];
      const plannedTools = Array.isArray(actMon?.tools) ? actMon.tools : [];
      if (plannedTools.length === 0) {
        continue;
      }
      const torCashAdvances = (draft.cashAdvances || []).filter(
        (ca) => ca.torId === tor.id && ca.status !== "Ditolak"
      );
      if (torCashAdvances.length === 0) {
        continue;
      }
      const outpRaci = draft.outputRaciRecords?.[tor.outputId];
      const fallbackResponsibleId = tor.picId || outpRaci?.responsibleUserId || "";
      const fallbackResponsibleName = tor.picName || tor.createdByName || outpRaci?.responsibleUserName || "";
      const timelineItems = Array.isArray(tor.timelineItems) ? tor.timelineItems : [];
      for (const ca of torCashAdvances) {
        const caResponsibleId = ca.requesterId || fallbackResponsibleId;
        const caResponsibleName = ca.requesterName || ca.signatures?.requestedBy?.name || fallbackResponsibleName;
        const linkedIds = /* @__PURE__ */ new Set();
        if (ca.implementationMode === "all") {
          timelineItems.forEach((tl) => {
            if (tl?.id) linkedIds.add(tl.id);
          });
        } else {
          if (Array.isArray(ca.implementationTimelineIds)) {
            ca.implementationTimelineIds.forEach((id) => {
              if (id) linkedIds.add(id);
            });
          }
          if (Array.isArray(ca.items)) {
            ca.items.forEach((it) => {
              if (it?.timelineItemId) linkedIds.add(it.timelineItemId);
            });
          }
        }
        const matchedTimelines = [];
        timelineItems.forEach((tl, idx) => {
          if (tl && linkedIds.has(tl.id)) {
            matchedTimelines.push({
              id: tl.id,
              period: tl.period || "",
              activity: tl.activity,
              stageIndex: idx + 1
            });
          }
        });
        if (matchedTimelines.length === 0) {
          matchedTimelines.push({
            id: `ca-tl-${ca.id}`,
            period: ca.activityStartDate || tor.startDate || "",
            activity: ca.implementationTimelineSummary || ca.activityTitle || tor.activityName || tor.title,
            stageIndex: 1
          });
        }
        const defaultDate = ca.activityStartDate || ca.requestDate || tor.startDate || nowIso.slice(0, 10);
        matchedTimelines.forEach((tl, tlIdxInCa) => {
          const periodLabel = tl.period ? ` (${tl.period})` : "";
          const implLabel = `Tahap ${tl.stageIndex}${periodLabel}: ${tl.activity}`;
          for (const tool of plannedTools) {
            if (!tool.toolId) continue;
            const itemId = tlIdxInCa === 0 ? `${tor.id}__${ca.id}__${tool.toolId}` : `${tor.id}__${ca.id}__${tl.id}__${tool.toolId}`;
            validIdsForScope.add(itemId);
            const existing = draft.monitoringReports[itemId];
            if (!existing) {
              draft.monitoringReports[itemId] = {
                id: itemId,
                torId: tor.id,
                torNumber: tor.torNumber,
                programId: tor.programId,
                programName: tor.programName,
                outcomeId: tor.outcomeId,
                outcomeName: tor.outcomeName,
                outputId: tor.outputId,
                outputName: tor.outputName,
                activityId: tor.activityId,
                activityName: tor.activityName,
                cashAdvanceId: ca.id,
                cashAdvanceNumber: ca.advanceNumber,
                cashAdvanceActivitySummary: implLabel,
                implementationList: [implLabel],
                timelineItemId: tl.id,
                timelinePeriod: tl.period,
                timelineActivity: tl.activity,
                toolId: tool.toolId,
                toolName: tool.toolName,
                toolCategoryCode: tool.categoryCode || "A",
                toolCategoryName: tool.categoryName || "",
                toolShortFunction: tool.shortFunction || "",
                toolNotes: tool.notes || "",
                plannedToolUrl: tool.toolUrl || "",
                responsibleUserId: caResponsibleId,
                responsibleName: caResponsibleName,
                monitoringDate: defaultDate,
                status: "Planned",
                mainEvidenceFolderUrl: "",
                sections: createEmptyMonitoringSections(),
                createdAt: nowIso,
                updatedAt: nowIso
              };
            } else {
              existing.torNumber = tor.torNumber;
              existing.programId = tor.programId;
              existing.programName = tor.programName;
              existing.outcomeId = tor.outcomeId;
              existing.outcomeName = tor.outcomeName;
              existing.outputId = tor.outputId;
              existing.outputName = tor.outputName;
              existing.activityId = tor.activityId;
              existing.activityName = tor.activityName;
              existing.cashAdvanceNumber = ca.advanceNumber;
              existing.cashAdvanceActivitySummary = implLabel;
              existing.implementationList = [implLabel];
              existing.timelineItemId = tl.id;
              existing.timelinePeriod = tl.period;
              existing.timelineActivity = tl.activity;
              existing.toolName = tool.toolName;
              existing.toolCategoryCode = tool.categoryCode || existing.toolCategoryCode || "A";
              existing.toolCategoryName = tool.categoryName || existing.toolCategoryName || "";
              existing.toolShortFunction = tool.shortFunction || existing.toolShortFunction || "";
              existing.toolNotes = tool.notes || existing.toolNotes || "";
              existing.plannedToolUrl = tool.toolUrl || existing.plannedToolUrl || "";
              existing.responsibleUserId = caResponsibleId;
              existing.responsibleName = caResponsibleName;
            }
          }
          const execItemId = `${tor.id}__${ca.id}__${tl.id}__EXEC-SUMMARY`;
          validIdsForScope.add(execItemId);
          const existingExec = draft.monitoringReports[execItemId];
          if (!existingExec) {
            const seedSource = tlIdxInCa === 0 && plannedTools[0]?.toolId ? draft.monitoringReports[`${tor.id}__${ca.id}__${plannedTools[0].toolId}`] : void 0;
            const hasSeedSections = seedSource && seedSource.sections && Object.values(seedSource.sections).some(
              (s) => s?.narrative && String(s.narrative).trim() !== ""
            );
            draft.monitoringReports[execItemId] = {
              id: execItemId,
              torId: tor.id,
              torNumber: tor.torNumber,
              programId: tor.programId,
              programName: tor.programName,
              outcomeId: tor.outcomeId,
              outcomeName: tor.outcomeName,
              outputId: tor.outputId,
              outputName: tor.outputName,
              activityId: tor.activityId,
              activityName: tor.activityName,
              cashAdvanceId: ca.id,
              cashAdvanceNumber: ca.advanceNumber,
              cashAdvanceActivitySummary: implLabel,
              implementationList: [implLabel],
              timelineItemId: tl.id,
              timelinePeriod: tl.period,
              timelineActivity: tl.activity,
              toolId: "EXEC-SUMMARY",
              toolName: "Executive Summary",
              toolCategoryCode: "A",
              toolCategoryName: "Executive Summary (7 Bagian Form Monitoring & Evidence)",
              toolShortFunction: "Ringkasan eksekutif pelaksanaan kegiatan mencakup 7 bagian pembelajaran & dampak (A\u2013G).",
              toolNotes: "A. Baseline, B. Intervention, C. Hasil, D. Context Learning, E. Reflection & Learning, F. Key Success Participation, G. Usulan Implementasi Selanjutnya",
              plannedToolUrl: "",
              responsibleUserId: caResponsibleId,
              responsibleName: caResponsibleName,
              monitoringDate: defaultDate,
              status: hasSeedSections ? seedSource.status : "Planned",
              mainEvidenceFolderUrl: hasSeedSections ? seedSource.mainEvidenceFolderUrl || "" : "",
              sections: hasSeedSections ? JSON.parse(JSON.stringify(seedSource.sections)) : createEmptyMonitoringSections(),
              createdAt: nowIso,
              updatedAt: nowIso
            };
          } else {
            existingExec.torNumber = tor.torNumber;
            existingExec.programId = tor.programId;
            existingExec.programName = tor.programName;
            existingExec.outcomeId = tor.outcomeId;
            existingExec.outcomeName = tor.outcomeName;
            existingExec.outputId = tor.outputId;
            existingExec.outputName = tor.outputName;
            existingExec.activityId = tor.activityId;
            existingExec.activityName = tor.activityName;
            existingExec.cashAdvanceNumber = ca.advanceNumber;
            existingExec.cashAdvanceActivitySummary = implLabel;
            existingExec.implementationList = [implLabel];
            existingExec.timelineItemId = tl.id;
            existingExec.timelinePeriod = tl.period;
            existingExec.timelineActivity = tl.activity;
            existingExec.responsibleUserId = caResponsibleId;
            existingExec.responsibleName = caResponsibleName;
          }
        });
      }
    }
    const allItems = Object.values(draft.monitoringReports || {});
    const filtered = targetTorId ? allItems.filter((item) => item.torId === targetTorId && validIdsForScope.has(item.id)) : allItems.filter((item) => validIdsForScope.has(item.id));
    return filtered.sort((a, b) => {
      const caCmp = a.cashAdvanceNumber.localeCompare(b.cashAdvanceNumber);
      if (caCmp !== 0) return caCmp;
      if (a.toolId === "EXEC-SUMMARY" && b.toolId !== "EXEC-SUMMARY") return 1;
      if (b.toolId === "EXEC-SUMMARY" && a.toolId !== "EXEC-SUMMARY") return -1;
      return a.toolId.localeCompare(b.toolId);
    });
  }
  app.get("/api/monitoring-reports", (req, res) => {
    const torId = typeof req.query.torId === "string" ? req.query.torId : void 0;
    let syncedItems = [];
    let plannedTools = [];
    let plannedToolsCount = 0;
    let cashAdvanceCount = 0;
    db.update((draft) => {
      syncedItems = syncMonitoringReportsForTor(draft, torId);
      if (torId) {
        const targetTor = (draft.tors || []).find((t) => t.id === torId);
        if (targetTor) {
          plannedTools = draft.activityMonitoringRecords?.[targetTor.activityId]?.tools || [];
          plannedToolsCount = plannedTools.length;
          cashAdvanceCount = (draft.cashAdvances || []).filter(
            (ca) => ca.torId === torId && ca.status !== "Ditolak"
          ).length;
        }
      }
    });
    res.json({
      items: syncedItems,
      plannedTools,
      plannedToolsCount,
      cashAdvanceCount
    });
  });
  app.put("/api/monitoring-reports/:id", (req, res) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);
    const body = req.body || {};
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    let updatedItem = null;
    db.update((draft) => {
      if (!draft.monitoringReports) draft.monitoringReports = {};
      const existing = draft.monitoringReports[id];
      if (!existing) return;
      const normalizeSection = (incoming, fallback, prefix) => {
        const narrative = incoming && typeof incoming.narrative === "string" ? incoming.narrative : fallback?.narrative || "";
        const rawLinks = Array.isArray(incoming?.evidenceLinks) ? incoming.evidenceLinks : fallback?.evidenceLinks || [];
        const evidenceLinks = rawLinks.length > 0 ? rawLinks.map((lnk, i) => ({
          id: String(lnk?.id || `ev-${prefix}-${Date.now()}-${i}`),
          label: String(lnk?.label || ""),
          url: String(lnk?.url || "")
        })) : [{ id: `ev-${prefix}-${Date.now()}-0`, label: "", url: "" }];
        return { narrative, evidenceLinks };
      };
      const nextSections = body.sections ? {
        baseline: normalizeSection(body.sections.baseline, existing.sections.baseline, "a"),
        intervention: normalizeSection(
          body.sections.intervention,
          existing.sections.intervention,
          "b"
        ),
        results: normalizeSection(body.sections.results, existing.sections.results, "c"),
        contextLearning: normalizeSection(
          body.sections.contextLearning,
          existing.sections.contextLearning,
          "d"
        ),
        reflectionLearning: normalizeSection(
          body.sections.reflectionLearning,
          existing.sections.reflectionLearning,
          "e"
        ),
        keySuccessParticipation: normalizeSection(
          body.sections.keySuccessParticipation,
          existing.sections.keySuccessParticipation,
          "f"
        ),
        nextImplementationProposal: normalizeSection(
          body.sections.nextImplementationProposal,
          existing.sections.nextImplementationProposal,
          "g"
        )
      } : existing.sections;
      const nextInvolvedParticipantIds = Array.isArray(body.involvedParticipantIds) ? Array.from(new Set(body.involvedParticipantIds.map((x) => String(x || "").trim()).filter(Boolean))) : Array.isArray(existing.involvedParticipantIds) ? existing.involvedParticipantIds : [];
      let nextStatus = existing.status;
      if (body.status === "Planned" || body.status === "In Progress" || body.status === "Completed") {
        nextStatus = body.status;
      } else {
        const hasAnyInput = nextInvolvedParticipantIds.length > 0 || Boolean(String(body.mainEvidenceFolderUrl ?? existing.mainEvidenceFolderUrl).trim()) || Object.values(nextSections).some(
          (sec) => sec.narrative.trim() !== "" || sec.evidenceLinks.some((l) => l.url.trim() !== "" || (l.label || "").trim() !== "")
        );
        if (existing.status === "Planned" && hasAnyInput) {
          nextStatus = "In Progress";
        }
      }
      const linkedCa = (draft.cashAdvances || []).find(
        (c) => c.id === existing.cashAdvanceId
      );
      const autoResponsibleId = linkedCa?.requesterId || existing.responsibleUserId;
      const autoResponsibleName = linkedCa?.requesterName || linkedCa?.signatures?.requestedBy?.name || existing.responsibleName;
      const nextRecord = {
        ...existing,
        monitoringDate: typeof body.monitoringDate === "string" && body.monitoringDate.trim() ? body.monitoringDate.trim() : existing.monitoringDate,
        responsibleUserId: autoResponsibleId,
        responsibleName: autoResponsibleName,
        mainEvidenceFolderUrl: typeof body.mainEvidenceFolderUrl === "string" ? body.mainEvidenceFolderUrl.trim() : existing.mainEvidenceFolderUrl,
        status: nextStatus,
        sections: nextSections,
        involvedParticipantIds: nextInvolvedParticipantIds,
        updatedById: currentUser.id,
        updatedByName: currentUser.name,
        updatedAt: nowIso
      };
      draft.monitoringReports[id] = nextRecord;
      updatedItem = nextRecord;
      if (nextInvolvedParticipantIds.length > 0 && existing.programId && Array.isArray(draft.participantDatabase)) {
        const prog = (draft.programs || []).find((p) => p.id === existing.programId);
        if (prog) {
          const selectedSet = new Set(nextInvolvedParticipantIds);
          for (let i = 0; i < draft.participantDatabase.length; i++) {
            const pRec = draft.participantDatabase[i];
            if (!selectedSet.has(pRec.id)) continue;
            const currentInvs = Array.isArray(pRec.programInvolvements) ? [...pRec.programInvolvements] : [];
            const invIdx = currentInvs.findIndex((inv) => inv.programId === prog.id);
            if (invIdx !== -1) {
              const prevOutIds = Array.isArray(currentInvs[invIdx].outcomeIds) ? currentInvs[invIdx].outcomeIds : [];
              const prevActIds = Array.isArray(currentInvs[invIdx].activityIds) ? currentInvs[invIdx].activityIds : [];
              currentInvs[invIdx] = {
                ...currentInvs[invIdx],
                outcomeIds: existing.outcomeId ? Array.from(/* @__PURE__ */ new Set([...prevOutIds, existing.outcomeId])) : prevOutIds,
                activityIds: existing.activityId ? Array.from(/* @__PURE__ */ new Set([...prevActIds, existing.activityId])) : prevActIds
              };
            } else {
              currentInvs.push({
                programId: prog.id,
                programCode: prog.code,
                programName: prog.name,
                roleInProgram: pRec.participantType === "INDIVIDU" ? pRec.communityRole : pRec.programRole,
                outcomeIds: existing.outcomeId ? [existing.outcomeId] : [],
                activityIds: existing.activityId ? [existing.activityId] : [],
                joinedAt: nowIso.slice(0, 10)
              });
            }
            draft.participantDatabase[i] = {
              ...pRec,
              programInvolvements: currentInvs,
              updatedAt: nowIso
            };
          }
        }
      }
      if (!body.isAutoSave) {
        draft.auditLogs.unshift({
          id: `log-mon-rep-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: nextStatus === "Completed" ? "Penyelesaian Laporan Monitoring (Tahap 06)" : "Pembaruan Draft Monitoring (Tahap 06)",
          entityType: "TOR",
          entityId: existing.torId,
          details: `Memperbarui Monitoring [${existing.toolId} ${existing.toolName}] pada Cash Advance ${existing.cashAdvanceNumber} (ToR ${existing.torNumber}) \u2014 Status: ${nextStatus}.`,
          timestamp: nowIso
        });
      }
    });
    if (!updatedItem) {
      return res.status(404).json({ error: "Item monitoring tidak ditemukan." });
    }
    res.json(updatedItem);
  });
  app.get("/api/approval-hub", (req, res) => {
    const currentUser = getCurrentUser(req);
    const draft = db.getData();
    syncMonitoringReportsForTor(draft);
    const synced = syncApprovalHubData(draft);
    const accessProfile = resolveUserApprovalAccess(draft, currentUser, synced.items);
    const visibleItems = filterApprovalItemsForUser(synced.items, currentUser, accessProfile);
    const responsibleItems = synced.items.filter(
      (i) => i.responsibleUserId === currentUser.id && i.status !== "Archived"
    );
    const responsibleItemIds = new Set(responsibleItems.map((i) => i.id));
    res.json({
      items: visibleItems,
      responsibleItems,
      configs: synced.configs,
      notifications: synced.notifications.filter(
        (n) => accessProfile.isDirector || n.targetUserIds.includes(currentUser.id) || responsibleItemIds.has(n.approvalItemId) || (accessProfile.isFinance || accessProfile.isA2) && (n.targetRoleCodes || []).includes("A2") || accessProfile.isA1 && (n.targetRoleCodes || []).includes("A1")
      ),
      accessProfile
    });
  });
  app.post("/api/approval-hub/notifications/read", (req, res) => {
    const currentUser = getCurrentUser(req);
    const { notificationId, markAll } = req.body || {};
    db.update((draft) => {
      if (!draft.approvalNotifications) return;
      for (const notif of draft.approvalNotifications) {
        if (markAll || notif.id === notificationId) {
          if (!notif.isReadByUserIds) notif.isReadByUserIds = [];
          if (!notif.isReadByUserIds.includes(currentUser.id)) {
            notif.isReadByUserIds.push(currentUser.id);
          }
        }
      }
    });
    res.json({ success: true });
  });
  app.post("/api/approval-hub/:id/action", (req, res) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);
    const { action, comment } = req.body || {};
    try {
      let result = null;
      db.update((draft) => {
        result = executeApprovalHubAction({
          draft,
          itemId: id,
          actor: currentUser,
          action,
          comment
        });
        if (result?.item?.sourceTorId) {
          syncTorBudgetInDraft(draft, result.item.sourceTorId);
        }
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message || "Gagal memproses tindakan persetujuan." });
    }
  });
  app.get("/api/finance-workspace/budgets", (_req, res) => {
    const data = db.getData();
    res.json(data.programBudgets || {});
  });
  app.put("/api/finance-workspace/budgets/:key", (req, res) => {
    const { key } = req.params;
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== "finance" && currentUser.role !== "director" && currentUser.role !== "program_manager" && currentUser.role !== "admin" && !currentUser.permissions?.canManagePrograms) {
      return res.status(403).json({
        error: "Akses ditolak: Hanya Finance, Direktur, atau Program Manager yang berwenang memperbarui Master Budget."
      });
    }
    const dataset = req.body;
    if (!dataset || typeof dataset !== "object") {
      return res.status(400).json({ error: "Data konfigurasi anggaran tidak valid." });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    let savedDataset = null;
    db.update((draft) => {
      if (!draft.programBudgets || typeof draft.programBudgets !== "object") {
        draft.programBudgets = {};
      }
      savedDataset = {
        ...dataset,
        id: key,
        updatedAt: nowIso,
        updatedBy: currentUser.name
      };
      draft.programBudgets[key] = savedDataset;
      draft.auditLogs.unshift({
        id: `log-fin-bgt-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: "Pembaruan Master Budget / Master Budget Code (Finance Workspace)",
        entityType: "PROGRAM",
        entityId: dataset.programId || key,
        details: `Memperbarui konfigurasi Finance Workspace untuk ${dataset.programName || key} (FY ${dataset.fiscalYear || ""}) oleh ${currentUser.name}.`,
        timestamp: nowIso
      });
    });
    res.json(savedDataset);
  });
  app.post("/api/approval-hub/workflow-config", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== "director" && currentUser.role !== "admin") {
      return res.status(403).json({
        error: "Akses ditolak: Hanya Direktur yang berwenang mengubah mekanisme alur persetujuan (Approval Hub)."
      });
    }
    const { categoryCode, mechanism, parallelRule } = req.body || {};
    if (!categoryCode || !mechanism) {
      return res.status(400).json({ error: "Kategori dan mekanisme alur persetujuan wajib diisi." });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    let updatedConfigs = {};
    db.update((draft) => {
      const synced = syncApprovalHubData(draft);
      updatedConfigs = synced.configs;
      updatedConfigs[categoryCode] = {
        categoryCode,
        mechanism: mechanism === "PARALLEL" ? "PARALLEL" : "SEQUENTIAL",
        parallelRule: parallelRule || "PRIMARY_WITH_CONSULTATION",
        updatedAt: nowIso,
        updatedByName: currentUser.name
      };
      for (const item of Object.values(draft.approvalHubItems || {})) {
        if (item.categoryCode === categoryCode) {
          item.workflowMechanism = updatedConfigs[categoryCode].mechanism;
          item.parallelRule = updatedConfigs[categoryCode].parallelRule;
        }
      }
      draft.auditLogs.unshift({
        id: `log-wf-cfg-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: "Pengaturan Alur Persetujuan (Approval Hub)",
        entityType: "TOR",
        entityId: categoryCode,
        details: `Mengubah mekanisme persetujuan kategori [${categoryCode}] menjadi ${mechanism} (${parallelRule || "PRIMARY_WITH_CONSULTATION"}).`,
        timestamp: nowIso
      });
    });
    res.json({
      message: "Pengaturan mekanisme alur persetujuan berhasil diperbarui.",
      configs: updatedConfigs
    });
  });
  const GROUP_COMPOSITION_KEYS = [
    "anak",
    "remaja",
    "pemuda",
    "dewasa",
    "lansia"
  ];
  function sanitizeNonNegativeInt(val) {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
  }
  function normalizeGroupComposition(raw) {
    const matrix = {};
    let totalMembers = 0;
    for (const key of GROUP_COMPOSITION_KEYS) {
      const row = raw && typeof raw === "object" ? raw[key] || {} : {};
      const lakiLaki = sanitizeNonNegativeInt(row.lakiLaki);
      const perempuan = sanitizeNonNegativeInt(row.perempuan);
      const lainnya = sanitizeNonNegativeInt(row.lainnya);
      const memilihTidakMenjawab = sanitizeNonNegativeInt(row.memilihTidakMenjawab);
      matrix[key] = {
        lakiLaki,
        perempuan,
        lainnya,
        memilihTidakMenjawab
      };
      totalMembers += lakiLaki + perempuan + lainnya + memilihTidakMenjawab;
    }
    return { matrix, totalMembers };
  }
  function getNextParticipantCode(records, type) {
    const prefix = type === "INDIVIDU" ? "IND-" : "KLP-";
    let maxSeq = 0;
    for (const r of records) {
      if (r.participantType === type && typeof r.participantCode === "string") {
        const match = r.participantCode.match(/(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxSeq) {
            maxSeq = num;
          }
        }
      }
    }
    return `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;
  }
  function normalizeParticipantProgramInvolvements(raw, programs, fallbackNowIso) {
    if (!Array.isArray(raw)) return [];
    const seen = /* @__PURE__ */ new Set();
    const result = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const programId = String(item.programId || "").trim();
      if (!programId || seen.has(programId)) continue;
      const matchedProg = (programs || []).find((p) => p.id === programId);
      const programName = matchedProg?.name || String(item.programName || "").trim();
      if (!programName) continue;
      seen.add(programId);
      const rolesArr = Array.isArray(item.rolesInProgram) ? item.rolesInProgram.map((r) => String(r || "").trim()).filter(Boolean) : item.roleInProgram ? String(item.roleInProgram).split(",").map((s) => s.trim()).filter(Boolean) : [];
      const outcomeIds = Array.isArray(item.outcomeIds) ? Array.from(new Set(item.outcomeIds.map((x) => String(x || "").trim()).filter(Boolean))) : void 0;
      const activityIds = Array.isArray(item.activityIds) ? Array.from(new Set(item.activityIds.map((x) => String(x || "").trim()).filter(Boolean))) : void 0;
      result.push({
        programId,
        programCode: matchedProg?.code || (item.programCode ? String(item.programCode).trim() : void 0),
        programName,
        roleInProgram: rolesArr.length > 0 ? rolesArr.join(", ") : item.roleInProgram ? String(item.roleInProgram).trim() : void 0,
        rolesInProgram: rolesArr.length > 0 ? rolesArr : void 0,
        outcomeIds: outcomeIds && outcomeIds.length > 0 ? outcomeIds : void 0,
        activityIds: activityIds && activityIds.length > 0 ? activityIds : void 0,
        joinedAt: item.joinedAt ? String(item.joinedAt).trim() : fallbackNowIso.slice(0, 10),
        notes: item.notes ? String(item.notes).trim() : void 0
      });
    }
    return result;
  }
  app.get("/api/participant-database", (_req, res) => {
    const data = db.getData();
    const rawRecords = Array.isArray(data.participantDatabase) ? data.participantDatabase : [];
    const programs = Array.isArray(data.programs) ? data.programs : [];
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const records = rawRecords.map((r) => ({
      ...r,
      programInvolvements: normalizeParticipantProgramInvolvements(
        r.programInvolvements,
        programs,
        r.createdAt || nowIso
      )
    }));
    const auditLogs = (Array.isArray(data.auditLogs) ? data.auditLogs : []).filter(
      (log) => log.entityType === "PARTICIPANT"
    );
    res.json({
      records,
      nextIndividualCode: getNextParticipantCode(records, "INDIVIDU"),
      nextGroupCode: getNextParticipantCode(records, "KELOMPOK/ORGANISASI"),
      auditLogs
    });
  });
  app.post("/api/participant-database", (req, res) => {
    const currentUser = getCurrentUser(req);
    const body = req.body || {};
    const participantType = body.participantType;
    if (participantType !== "INDIVIDU" && participantType !== "KELOMPOK/ORGANISASI") {
      return res.status(400).json({ error: "Jenis peserta wajib dipilih (INDIVIDU atau KELOMPOK/ORGANISASI)." });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    let createdRecord = null;
    if (participantType === "INDIVIDU") {
      const fullName = String(body.fullName || "").trim();
      if (!fullName) {
        return res.status(400).json({ error: "Nama Lengkap wajib diisi." });
      }
      db.update((draft) => {
        if (!Array.isArray(draft.participantDatabase)) {
          draft.participantDatabase = [];
        }
        const participantCode = getNextParticipantCode(draft.participantDatabase, "INDIVIDU");
        const involvements = normalizeParticipantProgramInvolvements(
          body.programInvolvements,
          draft.programs || [],
          nowIso
        );
        const communityRolesArr = Array.isArray(body.communityRoles) ? body.communityRoles.map((x) => String(x || "").trim()).filter(Boolean) : body.communityRole ? String(body.communityRole).split(",").map((s) => s.trim()).filter(Boolean) : ["Masyarakat Umum"];
        const normalizedCommunityRoles = communityRolesArr.length > 0 ? communityRolesArr : ["Masyarakat Umum"];
        const hasLainnya = normalizedCommunityRoles.includes("Lainnya") || String(body.communityRole || "").includes("Lainnya");
        const newIndividu = {
          id: `pst-ind-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          participantType: "INDIVIDU",
          participantCode,
          fullName,
          organizationInstitution: String(body.organizationInstitution || "").trim(),
          ageGroup: body.ageGroup || "Dewasa (31\u201359 tahun)",
          gender: body.gender || "Laki-laki",
          disability: body.disability || "Tidak",
          disabilityNotes: body.disability === "Ya" ? String(body.disabilityNotes || "").trim() : "",
          communityRole: normalizedCommunityRoles.join(", "),
          communityRoles: normalizedCommunityRoles,
          communityRoleNotes: hasLainnya ? String(body.communityRoleNotes || "").trim() : "",
          regionCommunity: String(body.regionCommunity || "").trim(),
          programInvolvements: involvements,
          createdAt: nowIso,
          updatedAt: nowIso
        };
        draft.participantDatabase.unshift(newIndividu);
        createdRecord = newIndividu;
        draft.auditLogs.unshift({
          id: `log-pst-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: "Tambah Data Peserta Individu (Database Peserta)",
          entityType: "PARTICIPANT",
          entityId: newIndividu.id,
          details: `Menambahkan peserta individu [${newIndividu.participantCode}] ${newIndividu.fullName}.`,
          timestamp: nowIso
        });
      });
    } else {
      const groupName = String(body.groupName || "").trim();
      if (!groupName) {
        return res.status(400).json({ error: "Nama Kelompok/Organisasi wajib diisi." });
      }
      const { matrix, totalMembers } = normalizeGroupComposition(body.memberComposition);
      db.update((draft) => {
        if (!Array.isArray(draft.participantDatabase)) {
          draft.participantDatabase = [];
        }
        const participantCode = getNextParticipantCode(
          draft.participantDatabase,
          "KELOMPOK/ORGANISASI"
        );
        const involvements = normalizeParticipantProgramInvolvements(
          body.programInvolvements,
          draft.programs || [],
          nowIso
        );
        const programRolesArr = Array.isArray(body.programRoles) ? body.programRoles.map((x) => String(x || "").trim()).filter(Boolean) : body.programRole ? String(body.programRole).split(",").map((s) => s.trim()).filter(Boolean) : ["Peserta"];
        const normalizedProgramRoles = programRolesArr.length > 0 ? programRolesArr : ["Peserta"];
        const hasLainnya = normalizedProgramRoles.includes("Lainnya") || String(body.programRole || "").includes("Lainnya");
        const newGroup = {
          id: `pst-klp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          participantType: "KELOMPOK/ORGANISASI",
          participantCode,
          groupName,
          groupCategory: body.groupCategory || "Komunitas",
          groupCategoryNotes: body.groupCategory === "Lainnya" ? String(body.groupCategoryNotes || "").trim() : "",
          regionCommunity: String(body.regionCommunity || "").trim(),
          contactPerson: String(body.contactPerson || "").trim(),
          programRole: normalizedProgramRoles.join(", "),
          programRoles: normalizedProgramRoles,
          programRoleNotes: hasLainnya ? String(body.programRoleNotes || "").trim() : "",
          memberComposition: matrix,
          totalMembers,
          programInvolvements: involvements,
          createdAt: nowIso,
          updatedAt: nowIso
        };
        draft.participantDatabase.unshift(newGroup);
        createdRecord = newGroup;
        draft.auditLogs.unshift({
          id: `log-pst-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: "Tambah Data Kelompok/Organisasi (Database Peserta)",
          entityType: "PARTICIPANT",
          entityId: newGroup.id,
          details: `Menambahkan kelompok/organisasi [${newGroup.participantCode}] ${newGroup.groupName} (${totalMembers} anggota).`,
          timestamp: nowIso
        });
      });
    }
    res.status(201).json(createdRecord);
  });
  app.put("/api/participant-database/:id", (req, res) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);
    const body = req.body || {};
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    let updatedRecord = null;
    let errorMsg = null;
    db.update((draft) => {
      if (!Array.isArray(draft.participantDatabase)) {
        draft.participantDatabase = [];
      }
      const idx = draft.participantDatabase.findIndex((r) => r.id === id);
      if (idx === -1) {
        errorMsg = "Data peserta tidak ditemukan.";
        return;
      }
      const existing = draft.participantDatabase[idx];
      const nextInvolvements = body.programInvolvements !== void 0 ? normalizeParticipantProgramInvolvements(
        body.programInvolvements,
        draft.programs || [],
        nowIso
      ) : normalizeParticipantProgramInvolvements(
        existing.programInvolvements,
        draft.programs || [],
        existing.createdAt || nowIso
      );
      if (existing.participantType === "INDIVIDU") {
        const fullName = String(body.fullName ?? existing.fullName).trim();
        if (!fullName) {
          errorMsg = "Nama Lengkap wajib diisi.";
          return;
        }
        const disability = body.disability ?? existing.disability;
        const communityRolesArr = Array.isArray(body.communityRoles) ? body.communityRoles.map((x) => String(x || "").trim()).filter(Boolean) : body.communityRole !== void 0 ? String(body.communityRole).split(",").map((s) => s.trim()).filter(Boolean) : Array.isArray(existing.communityRoles) && existing.communityRoles.length > 0 ? existing.communityRoles : [existing.communityRole || "Masyarakat Umum"];
        const normalizedCommunityRoles = communityRolesArr.length > 0 ? communityRolesArr : ["Masyarakat Umum"];
        const hasLainnya = normalizedCommunityRoles.includes("Lainnya");
        const updatedInd = {
          ...existing,
          fullName,
          organizationInstitution: String(
            body.organizationInstitution ?? existing.organizationInstitution ?? ""
          ).trim(),
          ageGroup: body.ageGroup ?? existing.ageGroup,
          gender: body.gender ?? existing.gender,
          disability,
          disabilityNotes: disability === "Ya" ? String(body.disabilityNotes ?? existing.disabilityNotes ?? "").trim() : "",
          communityRole: normalizedCommunityRoles.join(", "),
          communityRoles: normalizedCommunityRoles,
          communityRoleNotes: hasLainnya ? String(body.communityRoleNotes ?? existing.communityRoleNotes ?? "").trim() : "",
          regionCommunity: String(body.regionCommunity ?? existing.regionCommunity ?? "").trim(),
          programInvolvements: nextInvolvements,
          updatedAt: nowIso
        };
        draft.participantDatabase[idx] = updatedInd;
        updatedRecord = updatedInd;
        draft.auditLogs.unshift({
          id: `log-pst-upd-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: "Perbarui Data Peserta Individu (Database Peserta)",
          entityType: "PARTICIPANT",
          entityId: updatedInd.id,
          details: `Memperbarui peserta individu [${updatedInd.participantCode}] ${updatedInd.fullName}.`,
          timestamp: nowIso
        });
      } else {
        const groupName = String(body.groupName ?? existing.groupName).trim();
        if (!groupName) {
          errorMsg = "Nama Kelompok/Organisasi wajib diisi.";
          return;
        }
        const groupCategory = body.groupCategory ?? existing.groupCategory;
        const programRolesArr = Array.isArray(body.programRoles) ? body.programRoles.map((x) => String(x || "").trim()).filter(Boolean) : body.programRole !== void 0 ? String(body.programRole).split(",").map((s) => s.trim()).filter(Boolean) : Array.isArray(existing.programRoles) && existing.programRoles.length > 0 ? existing.programRoles : [existing.programRole || "Peserta"];
        const normalizedProgramRoles = programRolesArr.length > 0 ? programRolesArr : ["Peserta"];
        const hasLainnya = normalizedProgramRoles.includes("Lainnya");
        const { matrix, totalMembers } = normalizeGroupComposition(
          body.memberComposition ?? existing.memberComposition
        );
        const updatedGrp = {
          ...existing,
          groupName,
          groupCategory,
          groupCategoryNotes: groupCategory === "Lainnya" ? String(body.groupCategoryNotes ?? existing.groupCategoryNotes ?? "").trim() : "",
          regionCommunity: String(body.regionCommunity ?? existing.regionCommunity ?? "").trim(),
          contactPerson: String(body.contactPerson ?? existing.contactPerson ?? "").trim(),
          programRole: normalizedProgramRoles.join(", "),
          programRoles: normalizedProgramRoles,
          programRoleNotes: hasLainnya ? String(body.programRoleNotes ?? existing.programRoleNotes ?? "").trim() : "",
          memberComposition: matrix,
          totalMembers,
          programInvolvements: nextInvolvements,
          updatedAt: nowIso
        };
        draft.participantDatabase[idx] = updatedGrp;
        updatedRecord = updatedGrp;
        draft.auditLogs.unshift({
          id: `log-pst-upd-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: "Perbarui Data Kelompok/Organisasi (Database Peserta)",
          entityType: "PARTICIPANT",
          entityId: updatedGrp.id,
          details: `Memperbarui kelompok/organisasi [${updatedGrp.participantCode}] ${updatedGrp.groupName} (${totalMembers} anggota).`,
          timestamp: nowIso
        });
      }
    });
    if (errorMsg) {
      return res.status(400).json({ error: errorMsg });
    }
    res.json(updatedRecord);
  });
  app.post("/api/programs/:programId/participants-link", (req, res) => {
    const { programId } = req.params;
    const currentUser = getCurrentUser(req);
    const { participantIds, roleInProgram, notes, joinedAt } = req.body || {};
    if (!Array.isArray(participantIds) || participantIds.length === 0) {
      return res.status(400).json({ error: "Pilih minimal satu peserta dari Database Peserta." });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    let errorMsg = null;
    const updatedParticipants = [];
    db.update((draft) => {
      const prog = (draft.programs || []).find((p) => p.id === programId);
      if (!prog) {
        errorMsg = "Program tidak ditemukan.";
        return;
      }
      if (!Array.isArray(draft.participantDatabase)) {
        draft.participantDatabase = [];
      }
      const idSet = new Set(participantIds.map((x) => String(x)));
      for (let i = 0; i < draft.participantDatabase.length; i++) {
        const rec = draft.participantDatabase[i];
        if (!idSet.has(rec.id)) continue;
        const currentInvolvements = normalizeParticipantProgramInvolvements(
          rec.programInvolvements,
          draft.programs || [],
          rec.createdAt || nowIso
        );
        const existingIdx = currentInvolvements.findIndex((inv) => inv.programId === prog.id);
        const involvementItem = {
          programId: prog.id,
          programCode: prog.code,
          programName: prog.name,
          roleInProgram: roleInProgram ? String(roleInProgram).trim() : void 0,
          joinedAt: joinedAt ? String(joinedAt).trim() : nowIso.slice(0, 10),
          notes: notes ? String(notes).trim() : void 0
        };
        if (existingIdx !== -1) {
          currentInvolvements[existingIdx] = {
            ...currentInvolvements[existingIdx],
            ...involvementItem,
            roleInProgram: involvementItem.roleInProgram ?? currentInvolvements[existingIdx].roleInProgram,
            notes: involvementItem.notes ?? currentInvolvements[existingIdx].notes
          };
        } else {
          currentInvolvements.push(involvementItem);
        }
        const updatedRec = {
          ...rec,
          programInvolvements: currentInvolvements,
          updatedAt: nowIso
        };
        draft.participantDatabase[i] = updatedRec;
        updatedParticipants.push(updatedRec);
      }
      if (updatedParticipants.length > 0) {
        draft.auditLogs.unshift({
          id: `log-pst-link-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: "Hubungkan Peserta Master ke Program",
          entityType: "PARTICIPANT",
          entityId: prog.id,
          details: `Menghubungkan ${updatedParticipants.length} peserta dari Database Peserta ke program "${prog.name}".`,
          timestamp: nowIso
        });
      }
    });
    if (errorMsg) {
      return res.status(404).json({ error: errorMsg });
    }
    res.json({
      message: `${updatedParticipants.length} peserta berhasil dihubungkan ke program.`,
      updatedParticipants
    });
  });
  app.delete(
    "/api/programs/:programId/participants-link/:participantId",
    (req, res) => {
      const { programId, participantId } = req.params;
      const currentUser = getCurrentUser(req);
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      let updatedRecord = null;
      db.update((draft) => {
        if (!Array.isArray(draft.participantDatabase)) return;
        const idx = draft.participantDatabase.findIndex((r) => r.id === participantId);
        if (idx === -1) return;
        const existing = draft.participantDatabase[idx];
        const filtered = (existing.programInvolvements || []).filter(
          (inv) => inv.programId !== programId
        );
        const nextRec = {
          ...existing,
          programInvolvements: normalizeParticipantProgramInvolvements(
            filtered,
            draft.programs || [],
            existing.createdAt || nowIso
          ),
          updatedAt: nowIso
        };
        draft.participantDatabase[idx] = nextRec;
        updatedRecord = nextRec;
        const prog = (draft.programs || []).find((p) => p.id === programId);
        const label = existing.participantType === "INDIVIDU" ? existing.fullName : existing.groupName;
        draft.auditLogs.unshift({
          id: `log-pst-unlink-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: "Lepaskan Keterlibatan Program Peserta",
          entityType: "PARTICIPANT",
          entityId: existing.id,
          details: `Melepaskan keterlibatan [${existing.participantCode}] ${label} dari program "${prog?.name || programId}" (profil master tetap tersimpan di Database Peserta).`,
          timestamp: nowIso
        });
      });
      if (!updatedRecord) {
        return res.status(404).json({ error: "Data peserta tidak ditemukan." });
      }
      res.json(updatedRecord);
    }
  );
  app.delete("/api/participant-database/:id", (req, res) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== "director" && currentUser.role !== "program_manager" && currentUser.role !== "meal" && currentUser.role !== "admin" && !currentUser.permissions?.canManagePrograms) {
      return res.status(403).json({
        error: "Akses ditolak: Hanya Direktur, Program Manager, atau MEAL yang berwenang menghapus profil master peserta."
      });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    let deleted = false;
    db.update((draft) => {
      if (!Array.isArray(draft.participantDatabase)) return;
      const idx = draft.participantDatabase.findIndex((r) => r.id === id);
      if (idx === -1) return;
      const target = draft.participantDatabase[idx];
      draft.participantDatabase.splice(idx, 1);
      deleted = true;
      const label = target.participantType === "INDIVIDU" ? target.fullName : target.groupName;
      draft.auditLogs.unshift({
        id: `log-pst-del-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: "Hapus Data Peserta (Database Peserta)",
        entityType: "PARTICIPANT",
        entityId: id,
        details: `Menghapus data [${target.participantCode}] ${label} dari Database Peserta.`,
        timestamp: nowIso
      });
    });
    if (!deleted) {
      return res.status(404).json({ error: "Data peserta tidak ditemukan." });
    }
    res.json({ message: "Data peserta berhasil dihapus." });
  });
  function appendAttendanceAudit(draft, actor, module, action, details, targetUserName) {
    const sys = ensureAttendanceSystemInitialized(draft);
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const entry = {
      id: `att-aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: nowIso,
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.roleTitle,
      module,
      action,
      targetUserName,
      details
    };
    sys.auditTrail.unshift(entry);
    draft.auditLogs.unshift({
      id: `log-att-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.roleTitle,
      action: `[Attendance & Timesheet] ${action}`,
      entityType: "ATTENDANCE",
      entityId: entry.id,
      details,
      timestamp: nowIso
    });
  }
  function isHrAuthorized(user) {
    return user.role === "finance" || user.role === "hr" || user.role === "admin";
  }
  function isDirectorAuthorized(user) {
    return user.role === "director" || user.role === "admin";
  }
  function buildAttendanceBundleForUser(currentUser) {
    let bundle = db.getData().attendanceSystem;
    if (!bundle) {
      db.update((draft) => {
        bundle = ensureAttendanceSystemInitialized(draft);
      });
    } else {
      bundle = ensureAttendanceSystemInitialized(db.getData());
    }
    const canViewAll = isHrAuthorized(currentUser) || isDirectorAuthorized(currentUser);
    if (!canViewAll && bundle) {
      const redactedRecords = (bundle.records || []).map(
        (rec) => rec.userId === currentUser.id ? rec : {
          ...rec,
          clockInLatitude: void 0,
          clockInLongitude: void 0,
          clockOutLatitude: void 0,
          clockOutLongitude: void 0,
          outsideLocationReason: void 0,
          clockOutOutsideLocationReason: void 0,
          hrReviewNotes: void 0,
          directorReviewNotes: void 0
        }
      );
      const redactedLeaves = (bundle.leaveRequests || []).map(
        (lv) => lv.userId === currentUser.id ? lv : {
          ...lv,
          reason: "",
          hrNotes: void 0,
          directorNotes: void 0,
          returnReason: void 0
        }
      );
      return {
        ...bundle,
        records: redactedRecords,
        leaveRequests: redactedLeaves,
        auditTrail: bundle.auditTrail.filter((a) => a.actorId === currentUser.id)
      };
    }
    return bundle;
  }
  app.get("/api/attendance-system", (req, res) => {
    const currentUser = getCurrentUser(req);
    res.json(buildAttendanceBundleForUser(currentUser));
  });
  app.post("/api/attendance-system/clock-in", (req, res) => {
    const currentUser = getCurrentUser(req);
    const {
      date,
      latitude,
      longitude,
      outsideReason,
      allowOutsideWithHrApproval,
      workItems
    } = req.body || {};
    const currentSysSnapshot = ensureAttendanceSystemInitialized(db.getData());
    const existingActiveSession = findActiveClockSessionForUser(
      currentSysSnapshot.records,
      currentUser.id
    );
    if (existingActiveSession) {
      return res.json({
        record: existingActiveSession,
        bundle: buildAttendanceBundleForUser(currentUser),
        alreadyActive: true
      });
    }
    const targetDate = date && String(date).trim() ? String(date).trim() : (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const lat = Number(latitude);
    const lon = Number(longitude);
    const accuracyMargin = Math.min(200, Math.max(0, Math.round(Number(req.body?.gpsAccuracy) || 0)));
    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ error: "Koordinat lokasi Clock In tidak valid." });
    }
    if (!Array.isArray(workItems) || workItems.length === 0) {
      return res.status(400).json({ error: "Pilih minimal satu jenis pekerjaan untuk Timesheet Harian saat Clock In." });
    }
    let createdOrUpdated = null;
    let alreadyActiveInTx = false;
    let errMsg = null;
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      const activeInDraft = findActiveClockSessionForUser(sys.records, currentUser.id);
      if (activeInDraft) {
        createdOrUpdated = activeInDraft;
        alreadyActiveInTx = true;
        return;
      }
      const existingIdx = sys.records.findIndex(
        (r) => r.userId === currentUser.id && r.date === targetDate
      );
      if (existingIdx !== -1 && Boolean(sys.records[existingIdx].clockInTime) && Boolean(sys.records[existingIdx].clockOutTime)) {
        errMsg = "Anda sudah menyelesaikan sesi Clock In dan Clock Out pada tanggal ini.";
        return;
      }
      const activeWfa = sys.wfaRequests.find((w) => {
        const sDate = w.startDate || w.date;
        const eDate = w.endDate || sDate;
        const isParticipant = w.userId === currentUser.id || Array.isArray(w.invitedUserIds) && w.invitedUserIds.includes(currentUser.id);
        return isParticipant && isAttendanceArrangementActiveOnCalendar(w.status, w.workflowType) && sDate <= targetDate && eDate >= targetDate;
      });
      if (activeWfa) {
        errMsg = "Pada hari WFA yang aktif di kalender, Anda tidak melakukan Clock In/Clock Out. Silakan langsung mengisi Kontribusi Harian WFA.";
        return;
      }
      const rawDistanceMeters = calculateDistanceMeters(
        sys.locationConfig.latitude,
        sys.locationConfig.longitude,
        lat,
        lon
      );
      const distanceMeters = Math.max(0, rawDistanceMeters - accuracyMargin);
      const isOutside = distanceMeters > sys.locationConfig.radiusMeters;
      if (isOutside && !allowOutsideWithHrApproval) {
        errMsg = `Tidak dapat melakukan Clock In karena posisi Anda berada di luar titik koordinat WIJNA (${distanceMeters}m > radius ${sys.locationConfig.radiusMeters}m). Pilih opsi "Tetap Clock In (Sah Setelah Mendapat ACC dari HR)" jika Anda tetap ingin Clock In dari luar kantor.`;
        return;
      }
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const activeFlex = sys.flextimeAssignments.find(
        (f) => f.userId === currentUser.id && f.isActive && f.startDate <= targetDate && f.endDate >= targetDate
      );
      const newTimesheetItems = workItems.slice(0, 2).map((w, idx) => ({
        id: `ts-${Date.now()}-${idx}`,
        category: w.category,
        shortDescription: String(w.shortDescription || w.category).trim(),
        createdAt: nowIso
      }));
      const clockInLoc = {
        latitude: lat,
        longitude: lon,
        distanceMeters,
        isOutsideWorkLocation: isOutside,
        locationLabel: isOutside ? `Outside Work Location (${lat.toFixed(4)}, ${lon.toFixed(4)} \u2022 ${distanceMeters}m)` : `${sys.locationConfig.officeName} (${distanceMeters}m)`,
        outsideReason: isOutside ? String(outsideReason || "").trim() : void 0
      };
      if (existingIdx !== -1) {
        const prev = sys.records[existingIdx];
        const updated = {
          ...prev,
          recordType: "ATTENDANCE",
          clockInTime: prev.clockInTime || nowIso,
          clockInLocation: prev.clockInLocation || clockInLoc,
          clockOutTime: void 0,
          clockOutLocation: void 0,
          totalWorkHours: 0,
          isOutsideWorkLocation: prev.isOutsideWorkLocation || isOutside,
          outsideLocationReason: isOutside ? String(outsideReason || "").trim() : prev.outsideLocationReason,
          outsideReviewStatus: prev.isOutsideWorkLocation || isOutside ? "PENDING_HR_REVIEW" : "NOT_REQUIRED",
          isFlextimeApplied: Boolean(activeFlex),
          flextimeRuleLabel: activeFlex?.scheduleArrangement,
          timesheetItems: newTimesheetItems,
          updatedAt: nowIso
        };
        sys.records[existingIdx] = updated;
        createdOrUpdated = updated;
      } else {
        const fresh = {
          id: `att-${targetDate}-${currentUser.id}`,
          date: targetDate,
          userId: currentUser.id,
          userName: currentUser.name,
          userRoleTitle: currentUser.roleTitle,
          department: currentUser.department,
          recordType: "ATTENDANCE",
          clockInTime: nowIso,
          clockInLocation: clockInLoc,
          totalWorkHours: 0,
          isOutsideWorkLocation: isOutside,
          outsideLocationReason: isOutside ? String(outsideReason || "").trim() : void 0,
          outsideReviewStatus: isOutside ? "PENDING_HR_REVIEW" : "NOT_REQUIRED",
          isFlextimeApplied: Boolean(activeFlex),
          flextimeRuleLabel: activeFlex?.scheduleArrangement,
          timesheetItems: newTimesheetItems,
          createdAt: nowIso,
          updatedAt: nowIso
        };
        sys.records.unshift(fresh);
        createdOrUpdated = fresh;
      }
      appendAttendanceAudit(
        draft,
        currentUser,
        isOutside ? "OUTSIDE_LOCATION" : "CLOCK_IN_OUT",
        isOutside ? "Clock In (Outside Work Location)" : "Clock In Harian",
        `${currentUser.name} melakukan Clock In pada ${targetDate} (${clockInLoc.locationLabel}). Pekerjaan Timesheet: ${newTimesheetItems.map((i) => i.category).join(", ")}.`,
        currentUser.name
      );
    });
    if (errMsg) {
      return res.status(400).json({ error: errMsg });
    }
    res.json({
      record: createdOrUpdated,
      bundle: buildAttendanceBundleForUser(currentUser),
      alreadyActive: alreadyActiveInTx
    });
  });
  app.post("/api/attendance-system/reset-today", (req, res) => {
    const currentUser = getCurrentUser(req);
    const { date } = req.body || {};
    const targetDate = date && String(date).trim() ? String(date).trim() : (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return res.status(400).json({ error: "Format tanggal presensi tidak valid." });
    }
    const currentSys = ensureAttendanceSystemInitialized(db.getData());
    const activeSession = findActiveClockSessionForUser(currentSys.records, currentUser.id);
    if (activeSession) {
      return res.status(409).json({
        error: "Sesi Clock In Anda sedang aktif dan tidak dapat direset, dihapus, atau dihentikan selain melalui aksi Clock Out secara eksplisit."
      });
    }
    const existingClockedRecord = currentSys.records.find(
      (r) => r.userId === currentUser.id && r.date === targetDate && Boolean(r.clockInTime)
    );
    if (existingClockedRecord) {
      return res.status(409).json({
        error: "Catatan presensi yang sudah memiliki Clock In tidak dapat dihapus atau direset."
      });
    }
    const targetTime = (/* @__PURE__ */ new Date(`${targetDate}T00:00:00Z`)).getTime();
    const nowUtcStart = (/* @__PURE__ */ new Date(`${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}T00:00:00Z`)).getTime();
    if (isNaN(targetTime) || Math.abs(targetTime - nowUtcStart) > 36 * 60 * 60 * 1e3) {
      return res.status(403).json({
        error: "Reset presensi mandiri hanya diizinkan untuk presensi hari berjalan demi menjaga keutuhan riwayat kehadiran."
      });
    }
    const periodPrefix = targetDate.slice(0, 7);
    const isPeriodVerified = Object.values(currentSys?.workRecapVerifications || {}).some(
      (v) => v?.userId === currentUser.id && v?.periodId?.includes(periodPrefix) && (v.financeVerified || v.directorVerified)
    );
    if (isPeriodVerified) {
      return res.status(403).json({
        error: "Periode rekapitulasi ini telah diverifikasi resmi dan tidak dapat direset."
      });
    }
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      const hadDraftRecord = sys.records.some(
        (r) => r.userId === currentUser.id && r.date === targetDate && !r.clockInTime
      );
      sys.records = sys.records.filter(
        (r) => !(r.userId === currentUser.id && r.date === targetDate && !r.clockInTime)
      );
      if (hadDraftRecord) {
        appendAttendanceAudit(
          draft,
          currentUser,
          "CLOCK_IN_OUT",
          "Reset Draft Presensi Hari Berjalan",
          `${currentUser.name} (${currentUser.roleTitle}) mereset draft presensi pra-Clock-In (${targetDate}).`
        );
      }
    });
    res.json({ bundle: buildAttendanceBundleForUser(currentUser) });
  });
  app.post("/api/attendance-system/timesheet", (req, res) => {
    const currentUser = getCurrentUser(req);
    const {
      date,
      timesheetItems
    } = req.body || {};
    const requestedDate = date && String(date).trim() ? String(date).trim() : (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    if (!Array.isArray(timesheetItems) || timesheetItems.length === 0) {
      return res.status(400).json({ error: "Timesheet harian harus memuat minimal 1 jenis pekerjaan." });
    }
    let updatedRecord = null;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      const activeIdx = sys.records.findIndex(
        (r) => r.userId === currentUser.id && isActiveAttendanceClockSession(r)
      );
      const dateIdx = sys.records.findIndex(
        (r) => r.userId === currentUser.id && r.date === requestedDate
      );
      const existingIdx = activeIdx !== -1 ? activeIdx : dateIdx;
      const targetDate = existingIdx !== -1 ? sys.records[existingIdx].date : requestedDate;
      const normalizedItems = timesheetItems.slice(0, 2).map((item, idx) => ({
        id: item.id || `ts-${Date.now()}-${idx}`,
        category: item.category,
        shortDescription: String(item.shortDescription || item.category).trim(),
        createdAt: nowIso,
        updatedAt: nowIso
      }));
      const approvedWfa = sys.wfaRequests.find((w) => {
        const sDate = w.startDate || w.date;
        const eDate = w.endDate || sDate;
        const isParticipant = w.userId === currentUser.id || Array.isArray(w.invitedUserIds) && w.invitedUserIds.includes(currentUser.id);
        return isParticipant && isAttendanceArrangementActiveOnCalendar(w.status, w.workflowType) && sDate <= targetDate && eDate >= targetDate;
      });
      if (existingIdx !== -1) {
        const prev = sys.records[existingIdx];
        const hasClockSession = Boolean(prev.clockInTime);
        const nextRec = {
          ...prev,
          // JANGAN PERNAH menimpa sesi Clock In menjadi WFA atau mengubah clockInTime / clockOutTime
          recordType: hasClockSession ? "ATTENDANCE" : approvedWfa ? "WFA" : prev.recordType,
          clockInTime: prev.clockInTime,
          clockInLocation: prev.clockInLocation,
          clockOutTime: prev.clockOutTime,
          clockOutLocation: prev.clockOutLocation,
          totalWorkHours: hasClockSession ? prev.totalWorkHours : approvedWfa ? sys.locationConfig.standardDailyHours : prev.totalWorkHours,
          wfaRequestId: hasClockSession ? prev.wfaRequestId : approvedWfa?.id || prev.wfaRequestId,
          timesheetItems: normalizedItems,
          updatedAt: nowIso
        };
        sys.records[existingIdx] = nextRec;
        updatedRecord = nextRec;
      } else {
        const fresh = {
          id: `att-${targetDate}-${currentUser.id}`,
          date: targetDate,
          userId: currentUser.id,
          userName: currentUser.name,
          userRoleTitle: currentUser.roleTitle,
          department: currentUser.department,
          recordType: approvedWfa ? "WFA" : "ATTENDANCE",
          totalWorkHours: approvedWfa ? sys.locationConfig.standardDailyHours : 0,
          isOutsideWorkLocation: false,
          outsideReviewStatus: "NOT_REQUIRED",
          isFlextimeApplied: false,
          wfaRequestId: approvedWfa?.id,
          timesheetItems: normalizedItems,
          createdAt: nowIso,
          updatedAt: nowIso
        };
        sys.records.unshift(fresh);
        updatedRecord = fresh;
      }
      appendAttendanceAudit(
        draft,
        currentUser,
        "TIMESHEET",
        "Pembaruan Timesheet Harian",
        `${currentUser.name} memperbarui Timesheet tanggal ${targetDate} (${normalizedItems.length} item pekerjaan: ${normalizedItems.map((i) => i.category).join(", ")}).`,
        currentUser.name
      );
    });
    res.json({ record: updatedRecord, bundle: buildAttendanceBundleForUser(currentUser) });
  });
  app.post("/api/attendance-system/clock-out", (req, res) => {
    const currentUser = getCurrentUser(req);
    const {
      recordId,
      date,
      latitude,
      longitude,
      outsideReason,
      workItems
    } = req.body || {};
    const targetDate = date && String(date).trim() ? String(date).trim() : (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const lat = Number(latitude);
    const lon = Number(longitude);
    const accuracyMargin = Math.min(200, Math.max(0, Math.round(Number(req.body?.gpsAccuracy) || 0)));
    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ error: "Koordinat lokasi Clock Out tidak valid." });
    }
    if (recordId && String(recordId).trim()) {
      const snap = ensureAttendanceSystemInitialized(db.getData());
      const byId = snap.records.find((r) => r.id === String(recordId).trim());
      if (byId && byId.userId !== currentUser.id) {
        return res.status(403).json({
          error: "Sesi Clock In aktif hanya dapat diakhiri oleh pengguna terautentikasi yang bersangkutan."
        });
      }
    }
    let updatedRecord = null;
    let alreadyClockedOut = false;
    let errMsg = null;
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      let idx = -1;
      if (recordId && String(recordId).trim()) {
        idx = sys.records.findIndex(
          (r) => r.id === String(recordId).trim() && r.userId === currentUser.id && isActiveAttendanceClockSession(r)
        );
      }
      if (idx === -1) {
        idx = sys.records.findIndex(
          (r) => r.userId === currentUser.id && r.date === targetDate && isActiveAttendanceClockSession(r)
        );
      }
      if (idx === -1) {
        idx = sys.records.findIndex(
          (r) => r.userId === currentUser.id && isActiveAttendanceClockSession(r)
        );
      }
      if (idx === -1) {
        const closedMatch = sys.records.find(
          (r) => r.userId === currentUser.id && (recordId && r.id === String(recordId).trim() || r.date === targetDate) && Boolean(r.clockInTime) && Boolean(r.clockOutTime)
        );
        if (closedMatch) {
          updatedRecord = closedMatch;
          alreadyClockedOut = true;
          return;
        }
        errMsg = "Anda belum melakukan Clock In atau tidak memiliki sesi Clock In yang sedang aktif.";
        return;
      }
      const prev = sys.records[idx];
      const rawDistanceMeters = calculateDistanceMeters(
        sys.locationConfig.latitude,
        sys.locationConfig.longitude,
        lat,
        lon
      );
      const distanceMeters = Math.max(0, rawDistanceMeters - accuracyMargin);
      const isOutside = distanceMeters > sys.locationConfig.radiusMeters;
      if (isOutside && (!outsideReason || !String(outsideReason).trim()) && !prev.outsideLocationReason) {
        errMsg = "Clock Out dilakukan di luar area WIJNA (Outside Work Location). Mohon isi keterangan singkat.";
        return;
      }
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const computedHours = Math.max(
        0.1,
        calculateWorkHoursBetween(prev.clockInTime, nowIso)
      );
      const finalTimesheetItems = Array.isArray(workItems) && workItems.length > 0 ? workItems.slice(0, 2).map((item, itemIdx) => ({
        id: item.id || prev.timesheetItems?.[itemIdx]?.id || `ts-${Date.now()}-${itemIdx}`,
        category: item.category,
        shortDescription: String(item.shortDescription || item.category).trim(),
        createdAt: prev.timesheetItems?.[itemIdx]?.createdAt || nowIso,
        updatedAt: nowIso
      })) : prev.timesheetItems;
      const clockOutLoc = {
        latitude: lat,
        longitude: lon,
        distanceMeters,
        isOutsideWorkLocation: isOutside,
        locationLabel: isOutside ? `Outside Work Location (${lat.toFixed(4)}, ${lon.toFixed(4)} \u2022 ${distanceMeters}m)` : `${sys.locationConfig.officeName} (${distanceMeters}m)`,
        outsideReason: isOutside ? String(outsideReason || prev.outsideLocationReason || "").trim() : void 0
      };
      const combinedOutside = prev.isOutsideWorkLocation || isOutside;
      const combinedReason = [
        prev.outsideLocationReason,
        isOutside && outsideReason ? String(outsideReason).trim() : ""
      ].filter(Boolean).join(" | ");
      const nextRec = {
        ...prev,
        // Pertahankan clockInTime & clockInLocation secara mutlak
        clockInTime: prev.clockInTime,
        clockInLocation: prev.clockInLocation,
        clockOutTime: nowIso,
        clockOutLocation: clockOutLoc,
        totalWorkHours: computedHours,
        timesheetItems: finalTimesheetItems,
        isOutsideWorkLocation: combinedOutside,
        outsideLocationReason: combinedReason || prev.outsideLocationReason,
        outsideReviewStatus: combinedOutside ? prev.outsideReviewStatus === "NOT_REQUIRED" ? "PENDING_HR_REVIEW" : prev.outsideReviewStatus : "NOT_REQUIRED",
        updatedAt: nowIso
      };
      sys.records[idx] = nextRec;
      updatedRecord = nextRec;
      appendAttendanceAudit(
        draft,
        currentUser,
        isOutside ? "OUTSIDE_LOCATION" : "CLOCK_IN_OUT",
        isOutside ? "Clock Out (Outside Work Location)" : "Clock Out Harian",
        `${currentUser.name} melakukan Clock Out pada sesi tanggal ${prev.date}. Total jam kerja: ${computedHours} jam (${clockOutLoc.locationLabel}).`,
        currentUser.name
      );
    });
    if (errMsg) {
      return res.status(400).json({ error: errMsg });
    }
    res.json({
      record: updatedRecord,
      bundle: buildAttendanceBundleForUser(currentUser),
      alreadyClockedOut
    });
  });
  app.post("/api/attendance-system/outside-location-review", (req, res) => {
    const currentUser = getCurrentUser(req);
    const {
      recordId,
      stage,
      decision,
      notes
    } = req.body || {};
    if (stage === "hr" && !isHrAuthorized(currentUser)) {
      return res.status(403).json({ error: "Hanya Finance/HR yang dapat memproses lokasi luar kantor." });
    }
    if (stage === "director" && !isDirectorAuthorized(currentUser)) {
      return res.status(403).json({ error: "Hanya Director yang dapat memberikan review/masukan lokasi luar kantor." });
    }
    if (decision === "return" && (!notes || !String(notes).trim())) {
      return res.status(400).json({
        error: "Pengembalian (Return) catatan wajib menyertakan alasan atau catatan klarifikasi dari Finance."
      });
    }
    let updatedRecord = null;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      const idx = sys.records.findIndex((r) => r.id === recordId);
      if (idx === -1) return;
      const prev = sys.records[idx];
      const wf = prev.workflowType || resolveAttendanceWorkflowType(prev.userId, void 0, prev.userRoleTitle);
      if (stage === "hr") {
        if (wf === "DIRECTOR_TO_FINANCE_NOTIFY") {
          sys.records[idx] = {
            ...prev,
            clockInTime: prev.clockInTime,
            clockOutTime: prev.clockOutTime,
            workflowType: wf,
            outsideReviewStatus: "ACKNOWLEDGED_BY_FINANCE",
            hrReviewByName: currentUser.name,
            hrReviewAt: nowIso,
            hrReviewNotes: notes ? String(notes).trim() : "Informasi lokasi kehadiran Direktur telah dicatat oleh Finance.",
            updatedAt: nowIso
          };
        } else if (decision === "return") {
          sys.records[idx] = {
            ...prev,
            clockInTime: prev.clockInTime,
            clockOutTime: prev.clockOutTime,
            workflowType: wf,
            outsideReviewStatus: "RETURNED_BY_FINANCE",
            hrReviewByName: currentUser.name,
            hrReviewAt: nowIso,
            returnReason: String(notes).trim(),
            hrReviewNotes: String(notes).trim(),
            updatedAt: nowIso
          };
        } else {
          sys.records[idx] = {
            ...prev,
            clockInTime: prev.clockInTime,
            clockOutTime: prev.clockOutTime,
            workflowType: wf,
            outsideReviewStatus: "HR_REVIEWED",
            hrReviewByName: currentUser.name,
            hrReviewAt: nowIso,
            hrReviewNotes: notes ? String(notes).trim() : "Approved oleh Finance.",
            updatedAt: nowIso
          };
        }
      } else {
        sys.records[idx] = {
          ...prev,
          clockInTime: prev.clockInTime,
          clockOutTime: prev.clockOutTime,
          workflowType: wf,
          outsideReviewStatus: wf === "FINANCE_TO_DIRECTOR_REVIEW" ? "REVIEWED_BY_DIRECTOR" : "DIRECTOR_ACKNOWLEDGED",
          directorAckByName: currentUser.name,
          directorAckAt: nowIso,
          directorAckNotes: notes ? String(notes).trim() : "Direview oleh Director untuk pengawasan & masukan strategis.",
          updatedAt: nowIso
        };
      }
      updatedRecord = sys.records[idx];
      appendAttendanceAudit(
        draft,
        currentUser,
        "OUTSIDE_LOCATION",
        stage === "hr" ? decision === "return" ? "Pengembalian (Returned) Outside Work Location oleh Finance" : wf === "DIRECTOR_TO_FINANCE_NOTIFY" ? "Pencatatan Informasi Outside Work Location Direktur oleh Finance" : "Persetujuan (Approved) Outside Work Location oleh Finance" : "Catatan Review Outside Work Location oleh Director",
        `${currentUser.name} memproses catatan Outside Work Location milik ${prev.userName} tanggal ${prev.date}. Catatan: ${notes || "-"}`,
        prev.userName
      );
    });
    if (!updatedRecord) {
      return res.status(404).json({ error: "Catatan kehadiran tidak ditemukan." });
    }
    res.json({ record: updatedRecord, bundle: db.getData().attendanceSystem });
  });
  app.put("/api/attendance-system/location-config", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (!isDirectorAuthorized(currentUser)) {
      return res.status(403).json({ error: "Hanya Direktur yang dapat menentukan titik koordinat lokasi dan radius kerja WIJNA." });
    }
    const { officeName, address, latitude, longitude, radiusMeters, standardDailyHours } = req.body || {};
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      sys.locationConfig = {
        officeName: officeName ? String(officeName).trim() : sys.locationConfig.officeName,
        address: address ? String(address).trim() : sys.locationConfig.address,
        latitude: !isNaN(Number(latitude)) ? Number(latitude) : sys.locationConfig.latitude,
        longitude: !isNaN(Number(longitude)) ? Number(longitude) : sys.locationConfig.longitude,
        radiusMeters: !isNaN(Number(radiusMeters)) ? Math.max(1, Number(radiusMeters)) : sys.locationConfig.radiusMeters,
        standardDailyHours: !isNaN(Number(standardDailyHours)) ? Math.max(1, Number(standardDailyHours)) : sys.locationConfig.standardDailyHours,
        updatedByName: currentUser.name,
        updatedAt: nowIso
      };
      appendAttendanceAudit(
        draft,
        currentUser,
        "POLICY",
        "Penentuan Titik Koordinat Lokasi Kerja WIJNA oleh Direktur",
        `Direktur (${currentUser.name}) menentukan titik koordinat lokasi kerja "${sys.locationConfig.officeName}" (${sys.locationConfig.latitude}, ${sys.locationConfig.longitude}, radius ${sys.locationConfig.radiusMeters}m).`
      );
    });
    res.json({ bundle: db.getData().attendanceSystem });
  });
  app.post("/api/attendance-system/flextime", (req, res) => {
    const currentUser = getCurrentUser(req);
    const {
      id,
      userId,
      startDate,
      endDate,
      scheduleArrangement,
      policyNotes,
      isActive,
      mode
    } = req.body || {};
    const isStaffRequest = mode === "staff_request" || !isHrAuthorized(currentUser) && !isDirectorAuthorized(currentUser);
    const resolvedUserId = isStaffRequest ? currentUser.id : userId || currentUser.id;
    if (!resolvedUserId || !startDate || !endDate || !scheduleArrangement) {
      return res.status(400).json({ error: "Staf, periode tanggal, dan pengaturan jadwal Flextime wajib diisi." });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      const targetUser = draft.users.find((u) => u.id === resolvedUserId) || currentUser;
      const userName = targetUser?.name || currentUser.name;
      const userRoleTitle = targetUser?.roleTitle || currentUser.roleTitle;
      const wf = resolveAttendanceWorkflowType(targetUser?.id, targetUser?.role, userRoleTitle);
      if (id && (isHrAuthorized(currentUser) || isDirectorAuthorized(currentUser))) {
        const idx = sys.flextimeAssignments.findIndex((f) => f.id === id);
        if (idx !== -1) {
          const nextActive = isActive !== void 0 ? Boolean(isActive) : true;
          sys.flextimeAssignments[idx] = {
            ...sys.flextimeAssignments[idx],
            userId: resolvedUserId,
            userName,
            userRoleTitle,
            department: targetUser?.department,
            workflowType: wf,
            startDate,
            endDate,
            scheduleArrangement: String(scheduleArrangement).trim(),
            policyNotes: String(policyNotes || "").trim(),
            isActive: nextActive,
            status: wf === "DIRECTOR_TO_FINANCE_NOTIFY" ? "Notified to Finance" : wf === "FINANCE_TO_DIRECTOR_REVIEW" ? "Submitted for Review" : nextActive ? "Approved" : sys.flextimeAssignments[idx].status || "Approved",
            assignedById: currentUser.id,
            assignedByName: currentUser.name,
            updatedAt: nowIso
          };
        }
      } else {
        const isDirectHrForEmployee = !isStaffRequest && isHrAuthorized(currentUser) && wf === "EMPLOYEE_TO_FINANCE_APPROVAL";
        const initialStatus = wf === "DIRECTOR_TO_FINANCE_NOTIFY" ? "Notified to Finance" : wf === "FINANCE_TO_DIRECTOR_REVIEW" ? "Submitted for Review" : isDirectHrForEmployee ? "Approved" : "Pending";
        const activeOnCalendar = isAttendanceArrangementActiveOnCalendar(initialStatus, wf);
        const newFlex = {
          id: `flex-${Date.now()}`,
          userId: resolvedUserId,
          userName,
          userRoleTitle,
          department: targetUser?.department,
          workflowType: wf,
          isActive: activeOnCalendar,
          status: initialStatus,
          startDate,
          endDate,
          scheduleArrangement: String(scheduleArrangement).trim(),
          policyNotes: String(policyNotes || "").trim(),
          assignedById: currentUser.id,
          assignedByName: wf === "DIRECTOR_TO_FINANCE_NOTIFY" ? `${currentUser.name} (Director \u2192 Finance: Notify for Information)` : wf === "FINANCE_TO_DIRECTOR_REVIEW" ? `${currentUser.name} (Finance \u2192 Director: Submit for Review)` : isDirectHrForEmployee ? `${currentUser.name} (Finance)` : `${currentUser.name} (Employee \u2192 Finance: Submit for Approval)`,
          reviewedByName: isDirectHrForEmployee ? currentUser.name : void 0,
          reviewedAt: isDirectHrForEmployee ? nowIso : void 0,
          createdAt: nowIso,
          updatedAt: nowIso
        };
        sys.flextimeAssignments.unshift(newFlex);
        if (activeOnCalendar) {
          for (let i = 0; i < sys.records.length; i++) {
            const rec = sys.records[i];
            if (rec.userId === resolvedUserId && rec.recordType === "ATTENDANCE" && rec.date >= startDate && rec.date <= endDate) {
              sys.records[i] = {
                ...rec,
                isFlextimeApplied: true,
                flextimeRuleLabel: newFlex.scheduleArrangement,
                updatedAt: nowIso
              };
            }
          }
        }
      }
      appendAttendanceAudit(
        draft,
        currentUser,
        "FLEXTIME",
        wf === "DIRECTOR_TO_FINANCE_NOTIFY" ? "Pemberitahuan Flextime Director ke Finance (Notify for Information)" : wf === "FINANCE_TO_DIRECTOR_REVIEW" ? "Pengajuan Review Flextime Finance ke Director (Submit for Review)" : isStaffRequest ? "Pengajuan Flextime oleh Staf ke Finance (Submit for Approval)" : "Pengaturan Flextime oleh Finance",
        `${currentUser.name} mengatur/mengajukan Flextime untuk ${userName} periode ${startDate} s/d ${endDate}: "${scheduleArrangement}".`,
        userName
      );
    });
    res.json({ bundle: db.getData().attendanceSystem });
  });
  app.post("/api/attendance-system/flextime/:id/decision", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (!isHrAuthorized(currentUser) && !isDirectorAuthorized(currentUser)) {
      return res.status(403).json({ error: "Hanya Finance atau Director yang dapat memproses Flextime." });
    }
    const { id } = req.params;
    const {
      decision,
      notes
    } = req.body || {};
    if ((decision === "return" || decision === "reject") && (!notes || !String(notes).trim())) {
      return res.status(400).json({
        error: "Pengembalian (Return) pengajuan wajib menyertakan alasan atau catatan klarifikasi yang jelas dari Finance."
      });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    let errMsg = null;
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      const idx = sys.flextimeAssignments.findIndex((f) => f.id === id);
      if (idx === -1) return;
      const prev = sys.flextimeAssignments[idx];
      const wf = prev.workflowType || resolveAttendanceWorkflowType(prev.userId, void 0, prev.userRoleTitle);
      if (wf === "DIRECTOR_TO_FINANCE_NOTIFY") {
        if (!isHrAuthorized(currentUser)) {
          errMsg = "Hanya Finance yang mencatat pemberitahuan (Acknowledge) dari Director.";
          return;
        }
        sys.flextimeAssignments[idx] = {
          ...prev,
          workflowType: wf,
          isActive: true,
          status: "Acknowledged by Finance",
          financeAcknowledgedByName: currentUser.name,
          financeAcknowledgedAt: nowIso,
          financeAckNotes: notes ? String(notes).trim() : "Informasi jadwal Flextime Director telah dicatat oleh Finance.",
          updatedAt: nowIso
        };
      } else if (wf === "FINANCE_TO_DIRECTOR_REVIEW") {
        if (!isDirectorAuthorized(currentUser)) {
          errMsg = "Pengajuan dari Finance direview oleh Director untuk masukan strategis.";
          return;
        }
        sys.flextimeAssignments[idx] = {
          ...prev,
          workflowType: wf,
          isActive: true,
          status: "Reviewed by Director",
          directorReviewedByName: currentUser.name,
          directorReviewedAt: nowIso,
          directorReviewNotes: notes ? String(notes).trim() : "Telah direview oleh Director (tanpa keberatan).",
          updatedAt: nowIso
        };
      } else {
        if (!isHrAuthorized(currentUser)) {
          errMsg = "Pengajuan staf (Employee \u2192 Finance) disetujui atau dikembalikan oleh Finance.";
          return;
        }
        const isApproved = decision === "approve";
        const reasonText = notes ? String(notes).trim() : "";
        sys.flextimeAssignments[idx] = {
          ...prev,
          workflowType: wf,
          isActive: isApproved,
          status: isApproved ? "Approved" : "Returned",
          reviewedByName: currentUser.name,
          reviewedAt: nowIso,
          returnReason: !isApproved ? reasonText : void 0,
          reviewNotes: reasonText || (isApproved ? "Approved oleh Finance & disinkronkan ke kalender." : "Returned oleh Finance untuk revisi/klarifikasi."),
          updatedAt: nowIso
        };
        if (isApproved) {
          for (let i = 0; i < sys.records.length; i++) {
            const rec = sys.records[i];
            if (rec.userId === prev.userId && rec.recordType === "ATTENDANCE" && rec.date >= prev.startDate && rec.date <= prev.endDate) {
              sys.records[i] = {
                ...rec,
                isFlextimeApplied: true,
                flextimeRuleLabel: prev.scheduleArrangement,
                updatedAt: nowIso
              };
            }
          }
        }
      }
      appendAttendanceAudit(
        draft,
        currentUser,
        "FLEXTIME",
        `Pemrosesan Flextime (${sys.flextimeAssignments[idx].status})`,
        `${currentUser.name} memproses Flextime milik ${prev.userName} (${prev.startDate} s/d ${prev.endDate}). Catatan: ${notes || "-"}`,
        prev.userName
      );
    });
    if (errMsg) {
      return res.status(403).json({ error: errMsg });
    }
    res.json({ bundle: db.getData().attendanceSystem });
  });
  app.delete("/api/attendance-system/flextime/:id", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (!isHrAuthorized(currentUser)) {
      return res.status(403).json({ error: "Hanya HR yang dapat menghapus atau menonaktifkan pengaturan Flextime." });
    }
    const { id } = req.params;
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      const target = sys.flextimeAssignments.find((f) => f.id === id);
      if (!target) return;
      sys.flextimeAssignments = sys.flextimeAssignments.filter((f) => f.id !== id);
      appendAttendanceAudit(
        draft,
        currentUser,
        "FLEXTIME",
        "Penghapusan Periode Flextime oleh HR",
        `HR (${currentUser.name}) menghapus pengaturan Flextime milik ${target.userName} (${target.startDate} s/d ${target.endDate}).`,
        target.userName
      );
    });
    res.json({ bundle: db.getData().attendanceSystem });
  });
  app.post("/api/attendance-system/leave-policies", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (!isHrAuthorized(currentUser)) {
      return res.status(403).json({ error: "Kategori dan kuota cuti hanya dapat dikelola oleh HR." });
    }
    const {
      id,
      code,
      name,
      group,
      allocationDaysPerYear,
      requiresAttachmentOrNote,
      termsAndProvisions,
      isActive
    } = req.body || {};
    if (!name || !group) {
      return res.status(400).json({ error: "Nama kategori cuti dan kelompok cuti wajib diisi." });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      if (id) {
        const idx = sys.leavePolicies.findIndex((p) => p.id === id);
        if (idx !== -1) {
          sys.leavePolicies[idx] = {
            ...sys.leavePolicies[idx],
            code: code ? String(code).trim() : sys.leavePolicies[idx].code,
            name: String(name).trim(),
            group,
            allocationDaysPerYear: Math.max(0, Number(allocationDaysPerYear) || 0),
            requiresAttachmentOrNote: Boolean(requiresAttachmentOrNote),
            termsAndProvisions: String(termsAndProvisions || "").trim(),
            isActive: isActive !== void 0 ? Boolean(isActive) : true,
            updatedByName: currentUser.name,
            updatedAt: nowIso
          };
        }
      } else {
        const newPol = {
          id: `leave-pol-${Date.now()}`,
          code: code ? String(code).trim() : `CT-${sys.leavePolicies.length + 1}`,
          name: String(name).trim(),
          group,
          allocationDaysPerYear: Math.max(0, Number(allocationDaysPerYear) || 0),
          requiresAttachmentOrNote: Boolean(requiresAttachmentOrNote),
          termsAndProvisions: String(termsAndProvisions || "").trim(),
          isActive: true,
          updatedByName: currentUser.name,
          updatedAt: nowIso
        };
        sys.leavePolicies.push(newPol);
      }
      appendAttendanceAudit(
        draft,
        currentUser,
        "LEAVE",
        id ? "Pembaruan Kebijakan Kategori Cuti oleh HR" : "Penambahan Kategori Cuti Baru oleh HR",
        `HR (${currentUser.name}) mengatur kategori cuti "${name}" (Alokasi: ${allocationDaysPerYear} hari/tahun).`
      );
    });
    res.json({ bundle: db.getData().attendanceSystem });
  });
  app.delete("/api/attendance-system/leave-policies/:id", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (!isHrAuthorized(currentUser)) {
      return res.status(403).json({ error: "Hanya Finance/HR yang dapat menghapus kategori cuti." });
    }
    const { id } = req.params;
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      const target = sys.leavePolicies.find((p) => p.id === id);
      if (!target) return;
      sys.leavePolicies = sys.leavePolicies.filter((p) => p.id !== id);
      appendAttendanceAudit(
        draft,
        currentUser,
        "LEAVE",
        "Penghapusan Kategori Cuti oleh Finance/HR",
        `Finance/HR (${currentUser.name}) menghapus kategori cuti "${target.name}" (${target.code}).`
      );
    });
    res.json({ bundle: db.getData().attendanceSystem });
  });
  app.post("/api/attendance-system/leave-requests", (req, res) => {
    const currentUser = getCurrentUser(req);
    const { categoryId, startDate, endDate, reason } = req.body || {};
    if (!categoryId || !startDate || !endDate) {
      return res.status(400).json({ error: "Pilih jenis cuti/izin dan rentang tanggal." });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      const pol = sys.leavePolicies.find((p) => p.id === categoryId) || sys.leavePolicies[0];
      const diffDays = calculateWorkingDaysBetween(startDate, endDate);
      const wf = resolveAttendanceWorkflowType(
        currentUser.id,
        currentUser.role,
        currentUser.roleTitle
      );
      const initialStatus = wf === "DIRECTOR_TO_FINANCE_NOTIFY" ? "Notified to Finance" : wf === "FINANCE_TO_DIRECTOR_REVIEW" ? "Submitted for Review" : "Pending";
      const reqItem = {
        id: `lv-${Date.now()}`,
        userId: currentUser.id,
        userName: currentUser.name,
        userRoleTitle: currentUser.roleTitle,
        department: currentUser.department,
        workflowType: wf,
        categoryId: pol.id,
        categoryName: pol.name,
        categoryGroup: pol.group,
        startDate,
        endDate,
        totalDays: diffDays,
        reason: reason ? String(reason).trim() : "",
        status: initialStatus,
        createdAt: nowIso,
        updatedAt: nowIso
      };
      sys.leaveRequests.unshift(reqItem);
      if (isAttendanceArrangementActiveOnCalendar(initialStatus, wf)) {
        const targetDates = enumerateDatesBetween(startDate, endDate, true);
        for (const dStr of targetDates) {
          const recIdx = sys.records.findIndex(
            (r) => r.userId === currentUser.id && r.date === dStr
          );
          if (recIdx === -1) {
            sys.records.unshift({
              id: `att-${dStr}-${currentUser.id}`,
              date: dStr,
              userId: currentUser.id,
              userName: currentUser.name,
              userRoleTitle: currentUser.roleTitle,
              department: currentUser.department,
              recordType: "LEAVE",
              workflowType: wf,
              totalWorkHours: 0,
              isOutsideWorkLocation: false,
              outsideReviewStatus: "NOT_REQUIRED",
              isFlextimeApplied: false,
              leaveRequestId: reqItem.id,
              leaveCategoryName: pol.name,
              timesheetItems: [],
              createdAt: nowIso,
              updatedAt: nowIso
            });
          } else if (!sys.records[recIdx].clockInTime) {
            sys.records[recIdx] = {
              ...sys.records[recIdx],
              recordType: "LEAVE",
              workflowType: wf,
              totalWorkHours: 0,
              leaveRequestId: reqItem.id,
              leaveCategoryName: pol.name,
              updatedAt: nowIso
            };
          }
        }
      }
      appendAttendanceAudit(
        draft,
        currentUser,
        "LEAVE",
        wf === "DIRECTOR_TO_FINANCE_NOTIFY" ? "Pemberitahuan Cuti / Izin Director ke Finance (Notify for Information)" : wf === "FINANCE_TO_DIRECTOR_REVIEW" ? "Pengajuan Review Cuti / Izin Finance ke Director (Submit for Review)" : "Pengajuan Cuti / Izin Staf ke Finance (Submit for Approval)",
        `${currentUser.name} (${wf === "DIRECTOR_TO_FINANCE_NOTIFY" ? "Director \u2192 Finance" : wf === "FINANCE_TO_DIRECTOR_REVIEW" ? "Finance \u2192 Director" : "Employee \u2192 Finance"}) mencatat ${pol.name} (${startDate} s/d ${endDate}, ${diffDays} hari kerja).`,
        currentUser.name
      );
    });
    res.json({ bundle: db.getData().attendanceSystem });
  });
  app.post("/api/attendance-system/leave-requests/:id/decision", (req, res) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const {
      stage,
      decision,
      notes
    } = req.body || {};
    if ((decision === "return" || decision === "reject") && (!notes || !String(notes).trim())) {
      return res.status(400).json({
        error: "Pengembalian (Return) pengajuan cuti/izin wajib menyertakan alasan atau catatan klarifikasi yang jelas dari Finance."
      });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    let errMsg = null;
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      const idx = sys.leaveRequests.findIndex((l) => l.id === id);
      if (idx === -1) return;
      const prev = sys.leaveRequests[idx];
      const wf = prev.workflowType || resolveAttendanceWorkflowType(prev.userId, void 0, prev.userRoleTitle);
      if (wf === "DIRECTOR_TO_FINANCE_NOTIFY") {
        if (!isHrAuthorized(currentUser)) {
          errMsg = "Hanya Finance yang mencatat pemberitahuan (Acknowledge) kehadiran/cuti dari Director.";
          return;
        }
        sys.leaveRequests[idx] = {
          ...prev,
          workflowType: wf,
          status: "Acknowledged by Finance",
          financeAcknowledgedByName: currentUser.name,
          financeAcknowledgedAt: nowIso,
          financeAckNotes: notes ? String(notes).trim() : "Informasi kehadiran/cuti Director telah dicatat oleh Finance untuk administrasi.",
          updatedAt: nowIso
        };
      } else if (wf === "FINANCE_TO_DIRECTOR_REVIEW") {
        if (!isDirectorAuthorized(currentUser)) {
          errMsg = "Hanya Director yang dapat memberikan review & masukan strategis atas pengajuan Finance.";
          return;
        }
        sys.leaveRequests[idx] = {
          ...prev,
          workflowType: wf,
          status: "Reviewed by Director",
          directorDecisionByName: currentUser.name,
          directorDecisionAt: nowIso,
          directorDecisionNotes: notes ? String(notes).trim() : "Telah direview oleh Director (pengawasan & masukan strategis tercatat).",
          updatedAt: nowIso
        };
      } else {
        if (!isHrAuthorized(currentUser) && !(stage === "director" && isDirectorAuthorized(currentUser))) {
          errMsg = "Hanya Finance yang berwenang menyetujui (Approve) atau mengembalikan (Return) pengajuan staf.";
          return;
        }
        const isApproved = decision === "approve";
        const reasonText = notes ? String(notes).trim() : "";
        sys.leaveRequests[idx] = {
          ...prev,
          workflowType: wf,
          status: isApproved ? "Approved" : "Returned",
          hrReviewerName: currentUser.name,
          hrReviewedAt: nowIso,
          returnReason: !isApproved ? reasonText : void 0,
          hrReviewNotes: reasonText || (isApproved ? "Approved oleh Finance. Otomatis tersinkronisasi ke Attendance & Team Calendar." : "Returned oleh Finance untuk revisi atau klarifikasi."),
          updatedAt: nowIso
        };
        if (isApproved) {
          const targetDates = enumerateDatesBetween(prev.startDate, prev.endDate, true);
          for (const dStr of targetDates) {
            const recIdx = sys.records.findIndex(
              (r) => r.userId === prev.userId && r.date === dStr
            );
            if (recIdx === -1) {
              sys.records.unshift({
                id: `att-${dStr}-${prev.userId}`,
                date: dStr,
                userId: prev.userId,
                userName: prev.userName,
                userRoleTitle: prev.userRoleTitle,
                department: prev.department,
                recordType: "LEAVE",
                workflowType: wf,
                totalWorkHours: 0,
                isOutsideWorkLocation: false,
                outsideReviewStatus: "NOT_REQUIRED",
                isFlextimeApplied: false,
                leaveRequestId: prev.id,
                leaveCategoryName: prev.categoryName,
                timesheetItems: [],
                createdAt: nowIso,
                updatedAt: nowIso
              });
            } else if (!sys.records[recIdx].clockInTime) {
              sys.records[recIdx] = {
                ...sys.records[recIdx],
                recordType: "LEAVE",
                workflowType: wf,
                totalWorkHours: 0,
                leaveRequestId: prev.id,
                leaveCategoryName: prev.categoryName,
                updatedAt: nowIso
              };
            }
          }
        }
      }
      appendAttendanceAudit(
        draft,
        currentUser,
        "LEAVE",
        `Pemrosesan Cuti / Izin (${sys.leaveRequests[idx].status})`,
        `${currentUser.name} memproses ${prev.categoryName} milik ${prev.userName} (${prev.startDate} s/d ${prev.endDate}). Status: ${sys.leaveRequests[idx].status}. Catatan: ${notes || "-"}`,
        prev.userName
      );
    });
    if (errMsg) {
      return res.status(403).json({ error: errMsg });
    }
    res.json({ bundle: db.getData().attendanceSystem });
  });
  app.post("/api/attendance-system/wfa", (req, res) => {
    const currentUser = getCurrentUser(req);
    const {
      mode,
      userId,
      date,
      startDate,
      endDate,
      reasonAndPlan,
      hrNotes,
      torId,
      torNumber,
      torTitle,
      implementationOption,
      isCustomImplementation,
      invitedUserIds
    } = req.body || {};
    const resolvedStart = String(startDate || date || "").trim();
    const resolvedEnd = String(endDate || resolvedStart || "").trim();
    if (!resolvedStart || !reasonAndPlan) {
      return res.status(400).json({ error: "Tanggal WFA dan rencana pekerjaan harian wajib diisi." });
    }
    if (mode === "hr_manual" && !isHrAuthorized(currentUser)) {
      return res.status(403).json({ error: "Hanya Finance/HR yang dapat memasukkan status WFA secara manual untuk staf." });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      const targetUser = mode === "hr_manual" && userId ? draft.users.find((u) => u.id === userId) || currentUser : currentUser;
      const cleanInvitedIds = Array.isArray(invitedUserIds) ? Array.from(
        new Set(
          invitedUserIds.map((id) => String(id).trim()).filter((id) => id && id !== targetUser.id)
        )
      ) : [];
      const invitedUsers = cleanInvitedIds.map((id) => draft.users.find((u) => u.id === id)).filter((u) => Boolean(u));
      const resolvedInvitedIds = invitedUsers.map((u) => u.id);
      const resolvedInvitedNames = invitedUsers.map((u) => u.name);
      const wf = resolveAttendanceWorkflowType(
        targetUser.id,
        targetUser.role,
        targetUser.roleTitle
      );
      const isHrDirectForEmployee = mode === "hr_manual" && wf === "EMPLOYEE_TO_FINANCE_APPROVAL";
      const initialStatus = wf === "DIRECTOR_TO_FINANCE_NOTIFY" ? "Notified to Finance" : wf === "FINANCE_TO_DIRECTOR_REVIEW" ? "Submitted for Review" : isHrDirectForEmployee ? "Approved" : "Pending";
      const totalDays = calculateWorkingDaysBetween(resolvedStart, resolvedEnd);
      const wfaItem = {
        id: `wfa-${Date.now()}`,
        userId: targetUser.id,
        userName: targetUser.name,
        userRoleTitle: targetUser.roleTitle,
        department: targetUser.department,
        workflowType: wf,
        date: resolvedStart,
        startDate: resolvedStart,
        endDate: resolvedEnd,
        totalDays,
        reasonAndPlan: String(reasonAndPlan).trim(),
        torId: torId ? String(torId).trim() : void 0,
        torNumber: torNumber ? String(torNumber).trim() : void 0,
        torTitle: torTitle ? String(torTitle).trim() : void 0,
        implementationOption: implementationOption ? String(implementationOption).trim() : void 0,
        isCustomImplementation: Boolean(isCustomImplementation),
        invitedUserIds: resolvedInvitedIds.length > 0 ? resolvedInvitedIds : void 0,
        invitedUserNames: resolvedInvitedNames.length > 0 ? resolvedInvitedNames : void 0,
        status: initialStatus,
        enteredManuallyByHr: isHrDirectForEmployee,
        hrManagedByName: isHrDirectForEmployee ? currentUser.name : void 0,
        hrManagedAt: isHrDirectForEmployee ? nowIso : void 0,
        hrNotes: isHrDirectForEmployee ? String(hrNotes || "Status WFA dimasukkan & disetujui oleh Finance.").trim() : void 0,
        createdAt: nowIso,
        updatedAt: nowIso
      };
      sys.wfaRequests.unshift(wfaItem);
      if (isAttendanceArrangementActiveOnCalendar(initialStatus, wf)) {
        const targetDates = enumerateDatesBetween(resolvedStart, resolvedEnd, true);
        const participantsToSync = [targetUser, ...invitedUsers];
        for (const pUser of participantsToSync) {
          for (const dStr of targetDates) {
            const existingRecIdx = sys.records.findIndex(
              (r) => r.userId === pUser.id && r.date === dStr
            );
            const descForParticipant = pUser.id === targetUser.id ? String(reasonAndPlan).trim() : `${String(reasonAndPlan).trim()} (Kolaborasi WFA bersama ${targetUser.name})`;
            if (existingRecIdx === -1) {
              sys.records.unshift({
                id: `att-${dStr}-${pUser.id}`,
                date: dStr,
                userId: pUser.id,
                userName: pUser.name,
                userRoleTitle: pUser.roleTitle,
                department: pUser.department,
                recordType: "WFA",
                workflowType: wf,
                totalWorkHours: sys.locationConfig.standardDailyHours,
                isOutsideWorkLocation: false,
                outsideReviewStatus: "NOT_REQUIRED",
                isFlextimeApplied: false,
                wfaRequestId: wfaItem.id,
                timesheetItems: [
                  {
                    id: `ts-wfa-${Date.now()}-${dStr}-${pUser.id}`,
                    category: "Perencanaan & Pengembangan",
                    shortDescription: descForParticipant,
                    createdAt: nowIso
                  }
                ],
                createdAt: nowIso,
                updatedAt: nowIso
              });
            } else if (!sys.records[existingRecIdx].clockInTime) {
              sys.records[existingRecIdx] = {
                ...sys.records[existingRecIdx],
                recordType: "WFA",
                workflowType: wf,
                totalWorkHours: sys.locationConfig.standardDailyHours,
                wfaRequestId: wfaItem.id,
                timesheetItems: sys.records[existingRecIdx].timesheetItems.length > 0 ? sys.records[existingRecIdx].timesheetItems : [
                  {
                    id: `ts-wfa-${Date.now()}-${dStr}-${pUser.id}`,
                    category: "Perencanaan & Pengembangan",
                    shortDescription: descForParticipant,
                    createdAt: nowIso
                  }
                ],
                updatedAt: nowIso
              };
            }
          }
        }
      }
      const rangeLabel = resolvedStart === resolvedEnd ? resolvedStart : `${resolvedStart} s/d ${resolvedEnd} (${totalDays} hari kerja)`;
      const invitedSuffix = resolvedInvitedNames.length > 0 ? ` (Mengajak staf: ${resolvedInvitedNames.join(", ")})` : "";
      appendAttendanceAudit(
        draft,
        currentUser,
        "WFA",
        wf === "DIRECTOR_TO_FINANCE_NOTIFY" ? "Pemberitahuan WFA Director ke Finance (Notify for Information)" : wf === "FINANCE_TO_DIRECTOR_REVIEW" ? "Pengajuan Review WFA Finance ke Director (Submit for Review)" : isHrDirectForEmployee ? "Penetapan WFA Staf oleh Finance (Approved)" : "Pengajuan WFA Staf ke Finance (Submit for Approval)",
        `${currentUser.name} mencatat WFA untuk ${targetUser.name}${invitedSuffix} pada tanggal ${rangeLabel}: "${reasonAndPlan}".`,
        targetUser.name
      );
    });
    res.json({ bundle: db.getData().attendanceSystem });
  });
  app.post("/api/attendance-system/wfa/:id/decision", (req, res) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const {
      stage,
      status,
      decision,
      notes
    } = req.body || {};
    const isReturning = decision === "return" || decision === "reject" || status === "Returned" || status === "Ditolak HR";
    if (isReturning && (!notes || !String(notes).trim())) {
      return res.status(400).json({
        error: "Pengembalian (Return) pengajuan WFA wajib menyertakan alasan atau catatan klarifikasi yang jelas dari Finance."
      });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    let errMsg = null;
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      const idx = sys.wfaRequests.findIndex((w) => w.id === id);
      if (idx === -1) return;
      const prev = sys.wfaRequests[idx];
      const sDate = prev.startDate || prev.date;
      const eDate = prev.endDate || sDate;
      const wf = prev.workflowType || resolveAttendanceWorkflowType(prev.userId, void 0, prev.userRoleTitle);
      if (wf === "DIRECTOR_TO_FINANCE_NOTIFY") {
        if (!isHrAuthorized(currentUser)) {
          errMsg = "Hanya Finance yang mencatat pemberitahuan (Acknowledge) jadwal WFA Director.";
          return;
        }
        sys.wfaRequests[idx] = {
          ...prev,
          workflowType: wf,
          status: "Acknowledged by Finance",
          financeAcknowledgedByName: currentUser.name,
          financeAcknowledgedAt: nowIso,
          financeAckNotes: notes ? String(notes).trim() : "Informasi jadwal WFA Director telah dicatat oleh Finance.",
          updatedAt: nowIso
        };
      } else if (wf === "FINANCE_TO_DIRECTOR_REVIEW") {
        if (!isDirectorAuthorized(currentUser)) {
          errMsg = "Hanya Director yang dapat memberikan review & masukan strategis atas WFA Finance.";
          return;
        }
        sys.wfaRequests[idx] = {
          ...prev,
          workflowType: wf,
          status: "Reviewed by Director",
          directorAcknowledgedByName: currentUser.name,
          directorAcknowledgedAt: nowIso,
          directorReviewNotes: notes ? String(notes).trim() : "Telah direview oleh Director (pengawasan & masukan strategis tercatat).",
          updatedAt: nowIso
        };
      } else {
        if (!isHrAuthorized(currentUser)) {
          errMsg = "Hanya Finance yang berwenang menyetujui (Approve) atau mengembalikan (Return) pengajuan WFA staf.";
          return;
        }
        const isApproved = !isReturning;
        const nextStatus = isApproved ? "Approved" : "Returned";
        const noteText = notes ? String(notes).trim() : "";
        sys.wfaRequests[idx] = {
          ...prev,
          workflowType: wf,
          status: nextStatus,
          hrManagedByName: currentUser.name,
          hrManagedAt: nowIso,
          returnReason: !isApproved ? noteText : void 0,
          hrNotes: noteText || (isApproved ? "Approved oleh Finance & disinkronkan ke Attendance dan Team Calendar." : "Returned oleh Finance untuk revisi/klarifikasi."),
          updatedAt: nowIso
        };
        if (isApproved) {
          const targetDates = enumerateDatesBetween(sDate, eDate, true);
          const ownerUser = draft.users.find((u) => u.id === prev.userId) || {
            id: prev.userId,
            name: prev.userName,
            roleTitle: prev.userRoleTitle,
            department: prev.department
          };
          const invitedUsersList = (prev.invitedUserIds || []).map((invId) => draft.users.find((u) => u.id === invId)).filter((u) => Boolean(u));
          const participantsToSync = [ownerUser, ...invitedUsersList];
          for (const pUser of participantsToSync) {
            const descForParticipant = pUser.id === prev.userId ? prev.reasonAndPlan : `${prev.reasonAndPlan} (Kolaborasi WFA bersama ${prev.userName})`;
            for (const dStr of targetDates) {
              const recIdx = sys.records.findIndex(
                (r) => r.userId === pUser.id && r.date === dStr
              );
              if (recIdx === -1) {
                sys.records.unshift({
                  id: `att-${dStr}-${pUser.id}`,
                  date: dStr,
                  userId: pUser.id,
                  userName: pUser.name,
                  userRoleTitle: pUser.roleTitle,
                  department: pUser.department,
                  recordType: "WFA",
                  workflowType: wf,
                  totalWorkHours: sys.locationConfig.standardDailyHours,
                  isOutsideWorkLocation: false,
                  outsideReviewStatus: "NOT_REQUIRED",
                  isFlextimeApplied: false,
                  wfaRequestId: prev.id,
                  timesheetItems: [
                    {
                      id: `ts-wfa-${Date.now()}-${dStr}-${pUser.id}`,
                      category: "Perencanaan & Pengembangan",
                      shortDescription: descForParticipant,
                      createdAt: nowIso
                    }
                  ],
                  createdAt: nowIso,
                  updatedAt: nowIso
                });
              } else if (!sys.records[recIdx].clockInTime) {
                sys.records[recIdx] = {
                  ...sys.records[recIdx],
                  recordType: "WFA",
                  workflowType: wf,
                  totalWorkHours: sys.locationConfig.standardDailyHours,
                  wfaRequestId: prev.id,
                  timesheetItems: sys.records[recIdx].timesheetItems.length > 0 ? sys.records[recIdx].timesheetItems : [
                    {
                      id: `ts-wfa-${Date.now()}-${dStr}-${pUser.id}`,
                      category: "Perencanaan & Pengembangan",
                      shortDescription: descForParticipant,
                      createdAt: nowIso
                    }
                  ],
                  updatedAt: nowIso
                };
              }
            }
          }
        }
      }
      appendAttendanceAudit(
        draft,
        currentUser,
        "WFA",
        `Pemrosesan WFA (${sys.wfaRequests[idx].status})`,
        `${currentUser.name} memproses WFA milik ${prev.userName} tanggal ${sDate === eDate ? sDate : `${sDate} s/d ${eDate}`}. Status: ${sys.wfaRequests[idx].status}. Catatan: ${notes || "-"}`,
        prev.userName
      );
    });
    if (errMsg) {
      return res.status(403).json({ error: errMsg });
    }
    res.json({ bundle: db.getData().attendanceSystem });
  });
  app.post("/api/attendance-system/holiday-requests", (req, res) => {
    const currentUser = getCurrentUser(req);
    const {
      title,
      startDate,
      endDate,
      reason,
      autoApproveByHr
    } = req.body || {};
    const resolvedStart = String(startDate || "").trim();
    const resolvedEnd = String(endDate || resolvedStart).trim();
    if (!title || !resolvedStart) {
      return res.status(400).json({ error: "Judul Hari Libur Bersama dan tanggal mulai wajib diisi." });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      if (!Array.isArray(sys.holidayRequests)) {
        sys.holidayRequests = [];
      }
      const wf = resolveAttendanceWorkflowType(
        currentUser.id,
        currentUser.role,
        currentUser.roleTitle
      );
      const isDirectHrApprove = Boolean(
        (autoApproveByHr || isHrAuthorized(currentUser)) && isHrAuthorized(currentUser)
      );
      const totalDays = calculateWorkingDaysBetween(resolvedStart, resolvedEnd);
      const initialStatus = wf === "DIRECTOR_TO_FINANCE_NOTIFY" ? "Notified to Finance" : wf === "FINANCE_TO_DIRECTOR_REVIEW" ? "Submitted for Review" : isDirectHrApprove ? "Approved" : "Pending";
      const item = {
        id: `hol-${Date.now()}`,
        userId: "ALL_TEAM",
        userName: "Seluruh Tim WIJNA",
        userRoleTitle: `Hari Libur Bersama (Oleh: ${currentUser.name})`,
        department: "Seluruh Divisi WIJNA",
        workflowType: wf,
        title: String(title).trim(),
        startDate: resolvedStart,
        endDate: resolvedEnd,
        totalDays,
        reason: String(reason || "").trim(),
        status: initialStatus,
        reviewedByName: isDirectHrApprove ? currentUser.name : void 0,
        reviewedAt: isDirectHrApprove ? nowIso : void 0,
        reviewNotes: isDirectHrApprove ? "Ditetapkan sebagai Hari Libur Bersama oleh Finance & diajukan untuk review Director." : void 0,
        createdAt: nowIso,
        updatedAt: nowIso
      };
      sys.holidayRequests.unshift(item);
      appendAttendanceAudit(
        draft,
        currentUser,
        "HOLIDAY",
        `Pencatatan Hari Libur Bersama (${initialStatus})`,
        `${currentUser.name} mencatat Hari Libur Bersama "${item.title}" (${resolvedStart} s/d ${resolvedEnd}, ${totalDays} hari kerja) untuk Seluruh Tim WIJNA.`,
        "Seluruh Tim WIJNA"
      );
    });
    res.json({ bundle: db.getData().attendanceSystem });
  });
  app.post("/api/attendance-system/holiday-requests/:id/decision", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (!isHrAuthorized(currentUser) && !isDirectorAuthorized(currentUser)) {
      return res.status(403).json({ error: "Hanya Finance atau Director yang dapat memproses Hari Libur Bersama." });
    }
    const { id } = req.params;
    const {
      decision,
      notes
    } = req.body || {};
    if ((decision === "return" || decision === "reject") && (!notes || !String(notes).trim())) {
      return res.status(400).json({
        error: "Pengembalian (Return) usulan Hari Libur Bersama wajib menyertakan alasan atau catatan dari Finance."
      });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      if (!Array.isArray(sys.holidayRequests)) {
        sys.holidayRequests = [];
      }
      const idx = sys.holidayRequests.findIndex((h) => h.id === id);
      if (idx === -1) return;
      const prev = sys.holidayRequests[idx];
      const wf = prev.workflowType || "EMPLOYEE_TO_FINANCE_APPROVAL";
      const isReturning = decision === "return" || decision === "reject";
      const isApproved = !isReturning;
      if (wf === "DIRECTOR_TO_FINANCE_NOTIFY" && isHrAuthorized(currentUser)) {
        sys.holidayRequests[idx] = {
          ...prev,
          status: "Acknowledged by Finance",
          financeAcknowledgedByName: currentUser.name,
          financeAcknowledgedAt: nowIso,
          financeAckNotes: notes ? String(notes).trim() : "Telah dicatat oleh Finance.",
          updatedAt: nowIso
        };
      } else if (wf === "FINANCE_TO_DIRECTOR_REVIEW" && isDirectorAuthorized(currentUser)) {
        sys.holidayRequests[idx] = {
          ...prev,
          status: "Reviewed by Director",
          directorAcknowledgedByName: currentUser.name,
          directorAcknowledgedAt: nowIso,
          directorReviewNotes: notes ? String(notes).trim() : "Direview oleh Director.",
          updatedAt: nowIso
        };
      } else {
        sys.holidayRequests[idx] = {
          ...prev,
          status: isApproved ? "Approved" : "Returned",
          reviewedByName: currentUser.name,
          reviewedAt: nowIso,
          returnReason: !isApproved && notes ? String(notes).trim() : void 0,
          reviewNotes: notes ? String(notes).trim() : isApproved ? "Approved oleh Finance." : "Returned oleh Finance.",
          updatedAt: nowIso
        };
      }
      if (isAttendanceArrangementActiveOnCalendar(sys.holidayRequests[idx].status, wf)) {
        const targetDates = enumerateDatesBetween(prev.startDate, prev.endDate, true);
        for (const dStr of targetDates) {
          const recIdx = sys.records.findIndex(
            (r) => r.userId === prev.userId && r.date === dStr
          );
          if (recIdx === -1) {
            sys.records.unshift({
              id: `att-${dStr}-${prev.userId}`,
              date: dStr,
              userId: prev.userId,
              userName: prev.userName,
              userRoleTitle: prev.userRoleTitle,
              department: prev.department,
              recordType: "HOLIDAY",
              workflowType: wf,
              totalWorkHours: 0,
              isOutsideWorkLocation: false,
              outsideReviewStatus: "NOT_REQUIRED",
              isFlextimeApplied: false,
              holidayRequestId: prev.id,
              holidayTitle: prev.title,
              timesheetItems: [],
              createdAt: nowIso,
              updatedAt: nowIso
            });
          } else if (!sys.records[recIdx].clockInTime) {
            sys.records[recIdx] = {
              ...sys.records[recIdx],
              recordType: "HOLIDAY",
              workflowType: wf,
              totalWorkHours: 0,
              holidayRequestId: prev.id,
              holidayTitle: prev.title,
              updatedAt: nowIso
            };
          }
        }
      }
      appendAttendanceAudit(
        draft,
        currentUser,
        "HOLIDAY",
        `Pemrosesan Hari Libur Bersama (${sys.holidayRequests[idx].status})`,
        `${currentUser.name} memproses Hari Libur Bersama "${prev.title}" (${prev.startDate} s/d ${prev.endDate}). Catatan: ${notes || "-"}`,
        prev.userName
      );
    });
    res.json({ bundle: db.getData().attendanceSystem });
  });
  app.post("/api/attendance-system/employee-trainings", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (!isHrAuthorized(currentUser)) {
      return res.status(403).json({
        error: "Hanya HR (Finance & HR) yang berwenang menginput atau memperbarui data pelatihan karyawan."
      });
    }
    const {
      id,
      userId,
      trainingTitle,
      organizer,
      category,
      startDate,
      endDate,
      durationHours,
      certificateOrEvidenceUrl,
      competencyNotes,
      items
    } = req.body || {};
    if (!userId) {
      return res.status(400).json({ error: "Pilih karyawan terlebih dahulu." });
    }
    const batchList = Array.isArray(items) && items.length > 0 ? items.filter((it) => String(it.trainingTitle || "").trim()) : trainingTitle && String(trainingTitle).trim() ? [
      {
        trainingTitle: String(trainingTitle).trim(),
        organizer: String(organizer || "Penyelenggara Pelatihan").trim(),
        category: String(category || "Pengembangan Kapasitas").trim(),
        startDate: String(startDate || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)).trim(),
        endDate: String(endDate || startDate || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)).trim(),
        durationHours: Number(durationHours) || 8,
        certificateOrEvidenceUrl: certificateOrEvidenceUrl ? String(certificateOrEvidenceUrl).trim() : void 0,
        competencyNotes: competencyNotes ? String(competencyNotes).trim() : void 0
      }
    ] : [];
    if (batchList.length === 0) {
      return res.status(400).json({ error: "Nama pelatihan wajib diisi minimal 1 pelatihan." });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      if (!Array.isArray(sys.employeeTrainings)) {
        sys.employeeTrainings = [];
      }
      const targetUser = draft.users.find((u) => u.id === userId) || currentUser;
      if (id && batchList.length === 1) {
        const idx = sys.employeeTrainings.findIndex((t) => t.id === id);
        if (idx !== -1) {
          const entry = batchList[0];
          const prev = sys.employeeTrainings[idx];
          sys.employeeTrainings[idx] = {
            ...prev,
            userId: targetUser.id,
            userName: targetUser.name,
            userRoleTitle: targetUser.roleTitle,
            department: targetUser.department,
            trainingTitle: entry.trainingTitle,
            organizer: entry.organizer || "Penyelenggara Pelatihan",
            category: entry.category || "Pengembangan Kapasitas",
            startDate: entry.startDate,
            endDate: entry.endDate || entry.startDate,
            durationHours: Math.max(1, Number(entry.durationHours) || 8),
            certificateOrEvidenceUrl: entry.certificateOrEvidenceUrl,
            competencyNotes: entry.competencyNotes,
            status: "Menunggu Persetujuan Director",
            createdByHrId: currentUser.id,
            createdByHrName: currentUser.name,
            updatedAt: nowIso
          };
          appendAttendanceAudit(
            draft,
            currentUser,
            "TRAINING",
            "Pembaruan Data Pelatihan Karyawan oleh HR",
            `HR (${currentUser.name}) memperbarui data pelatihan "${entry.trainingTitle}" untuk ${targetUser.name} dan mengajukan persetujuan Director.`,
            targetUser.name
          );
          return;
        }
      }
      for (let i = 0; i < batchList.length; i++) {
        const entry = batchList[i];
        const newRec = {
          id: `trn-${Date.now()}-${i}`,
          userId: targetUser.id,
          userName: targetUser.name,
          userRoleTitle: targetUser.roleTitle,
          department: targetUser.department,
          trainingTitle: entry.trainingTitle,
          organizer: entry.organizer || "Penyelenggara Pelatihan",
          category: entry.category || "Pengembangan Kapasitas",
          startDate: entry.startDate,
          endDate: entry.endDate || entry.startDate,
          durationHours: Math.max(1, Number(entry.durationHours) || 8),
          certificateOrEvidenceUrl: entry.certificateOrEvidenceUrl,
          competencyNotes: entry.competencyNotes,
          status: "Menunggu Persetujuan Director",
          createdByHrId: currentUser.id,
          createdByHrName: currentUser.name,
          createdAt: nowIso,
          updatedAt: nowIso
        };
        sys.employeeTrainings.unshift(newRec);
      }
      appendAttendanceAudit(
        draft,
        currentUser,
        "TRAINING",
        `Input Manual ${batchList.length} Pelatihan Karyawan oleh HR`,
        `HR (${currentUser.name}) menambahkan ${batchList.length} catatan pelatihan untuk ${targetUser.name} (${batchList.map((b) => `"${b.trainingTitle}"`).join(", ")}) \u2014 Menunggu Persetujuan Director.`,
        targetUser.name
      );
    });
    res.json({ bundle: db.getData().attendanceSystem });
  });
  app.delete("/api/attendance-system/employee-trainings/:id", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (!isHrAuthorized(currentUser) && !isDirectorAuthorized(currentUser)) {
      return res.status(403).json({ error: "Hanya HR atau Director yang dapat menghapus catatan pelatihan." });
    }
    const { id } = req.params;
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      if (!Array.isArray(sys.employeeTrainings)) return;
      const found = sys.employeeTrainings.find((t) => t.id === id);
      sys.employeeTrainings = sys.employeeTrainings.filter((t) => t.id !== id);
      if (found) {
        appendAttendanceAudit(
          draft,
          currentUser,
          "TRAINING",
          "Penghapusan Catatan Pelatihan Karyawan",
          `${currentUser.name} menghapus catatan pelatihan "${found.trainingTitle}" milik ${found.userName}.`,
          found.userName
        );
      }
    });
    res.json({ bundle: db.getData().attendanceSystem });
  });
  app.post("/api/attendance-system/employee-trainings/:id/decision", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (!isDirectorAuthorized(currentUser)) {
      return res.status(403).json({
        error: "Hanya Director yang berwenang menyetujui atau meminta revisi data pelatihan karyawan."
      });
    }
    const { id } = req.params;
    const {
      decision,
      notes,
      userId
    } = req.body || {};
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      if (!Array.isArray(sys.employeeTrainings)) {
        sys.employeeTrainings = [];
      }
      const nextStatus = decision === "approve" ? "Disetujui Director" : decision === "revision" ? "Perlu Revisi" : "Ditolak Director";
      if (id === "ALL_PENDING" && userId) {
        let count = 0;
        let targetName = "";
        sys.employeeTrainings = sys.employeeTrainings.map((t, i) => {
          if (t.userId === userId && t.status === "Menunggu Persetujuan Director") {
            count++;
            targetName = t.userName;
            const stampSuffix2 = Math.random().toString(16).slice(2, 6).toUpperCase();
            return {
              ...t,
              status: nextStatus,
              directorDecisionByName: currentUser.name,
              directorDecisionAt: nowIso,
              directorNotes: notes && String(notes).trim() ? String(notes).trim() : decision === "approve" ? "Disetujui oleh Executive Director dan disahkan dalam portofolio karyawan." : void 0,
              directorSignatureCode: decision === "approve" ? `STAMP-DIR-TRN-${String(i + 1).padStart(3, "0")}-${stampSuffix2}` : void 0,
              updatedAt: nowIso
            };
          }
          return t;
        });
        if (count > 0) {
          appendAttendanceAudit(
            draft,
            currentUser,
            "TRAINING",
            `Persetujuan Kolektif ${count} Pelatihan oleh Director`,
            `Director (${currentUser.name}) memproses ${count} pelatihan milik ${targetName} dengan status "${nextStatus}".`,
            targetName
          );
        }
        return;
      }
      const idx = sys.employeeTrainings.findIndex((t) => t.id === id);
      if (idx === -1) return;
      const prev = sys.employeeTrainings[idx];
      const stampSuffix = Math.random().toString(16).slice(2, 6).toUpperCase();
      sys.employeeTrainings[idx] = {
        ...prev,
        status: nextStatus,
        directorDecisionByName: currentUser.name,
        directorDecisionAt: nowIso,
        directorNotes: notes && String(notes).trim() ? String(notes).trim() : decision === "approve" ? "Disetujui oleh Executive Director." : decision === "revision" ? "Mohon HR melengkapi rincian penyelenggara / tautan sertifikat pelatihan." : "Ditolak oleh Executive Director.",
        directorSignatureCode: decision === "approve" ? `STAMP-DIR-TRN-${stampSuffix}` : void 0,
        updatedAt: nowIso
      };
      appendAttendanceAudit(
        draft,
        currentUser,
        "TRAINING",
        `Keputusan Director atas Pelatihan Karyawan (${nextStatus})`,
        `Director (${currentUser.name}) menetapkan status "${nextStatus}" untuk pelatihan "${prev.trainingTitle}" milik ${prev.userName}. Catatan: ${notes || "-"}`,
        prev.userName
      );
    });
    res.json({ bundle: db.getData().attendanceSystem });
  });
  app.post("/api/attendance-system/employee-profile-link", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (!isHrAuthorized(currentUser) && !isDirectorAuthorized(currentUser)) {
      return res.status(403).json({
        error: "Hanya HR (Finance & HR) yang berwenang mengatur tautan dokumen profil karyawan."
      });
    }
    const {
      userId,
      label,
      url
    } = req.body || {};
    if (!userId) {
      return res.status(400).json({ error: "Karyawan wajib dipilih." });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      if (!sys.employeeProfileLinks || typeof sys.employeeProfileLinks !== "object") {
        sys.employeeProfileLinks = {};
      }
      const targetUser = (draft.users || []).find((u) => u.id === userId);
      const trimmedUrl = String(url || "").trim();
      const trimmedLabel = String(label || "").trim() || `Dokumen & Portofolio Karyawan \u2014 ${targetUser?.name || userId}`;
      if (!trimmedUrl) {
        delete sys.employeeProfileLinks[userId];
      } else {
        sys.employeeProfileLinks[userId] = {
          userId,
          label: trimmedLabel,
          url: trimmedUrl,
          updatedByName: currentUser.name,
          updatedAt: nowIso
        };
      }
      appendAttendanceAudit(
        draft,
        currentUser,
        "POLICY",
        "Pembaruan Link Dokumen Profil Karyawan oleh HR",
        `HR (${currentUser.name}) memperbarui tautan dokumen profil untuk ${targetUser?.name || userId}: ${trimmedUrl || "Dihapus"}.`,
        targetUser?.name
      );
    });
    res.json({ bundle: db.getData().attendanceSystem });
  });
  app.post("/api/attendance-system/work-recap-verify", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (!isHrAuthorized(currentUser) && !isDirectorAuthorized(currentUser)) {
      return res.status(403).json({
        error: "Akses ditolak: Hanya HR/Finance atau Direktur yang berwenang mengesahkan verifikasi Rekap Kerja Resmi."
      });
    }
    const {
      userId,
      periodId,
      stage,
      notes
    } = req.body || {};
    if (!userId || !periodId || !stage) {
      return res.status(400).json({
        error: "Identitas karyawan, periode pelaporan, dan tahap verifikasi wajib diisi."
      });
    }
    if (stage === "finance" && !isHrAuthorized(currentUser)) {
      return res.status(403).json({
        error: "Hanya HR/Finance yang dapat melakukan verifikasi tahap HR/Finance."
      });
    }
    if (stage === "director" && !isDirectorAuthorized(currentUser)) {
      return res.status(403).json({
        error: "Hanya Direktur yang dapat melakukan pengesahan tahap Direktur."
      });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const key = `${userId}__${periodId}`;
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      if (!sys.workRecapVerifications || typeof sys.workRecapVerifications !== "object") {
        sys.workRecapVerifications = {};
      }
      const targetUser = (draft.users || []).find((u) => u.id === userId);
      const existing = sys.workRecapVerifications[key] || {
        key,
        userId,
        periodId,
        financeVerified: false,
        financeVerifierName: "",
        financeVerifierRole: "Finance & HR Manager",
        financeVerifiedAt: "",
        financeRefCode: `FIN-HR/${periodId.toUpperCase().slice(0, 6)}/${userId.replace(/^user-/, "").toUpperCase()}`,
        financeNotes: "",
        directorVerified: false,
        directorVerifierName: "",
        directorVerifierRole: "Executive Director",
        directorVerifiedAt: "",
        directorRefCode: `DIR-OVS/${periodId.toUpperCase().slice(0, 6)}/${userId.replace(/^user-/, "").toUpperCase()}`,
        directorNotes: "",
        updatedAt: nowIso
      };
      if (stage === "finance") {
        existing.financeVerified = true;
        existing.financeVerifierName = currentUser.name;
        existing.financeVerifierRole = currentUser.roleTitle || "Finance & HR Manager";
        existing.financeVerifiedAt = nowIso;
        existing.financeNotes = notes?.trim() || "Catatan Timesheet, jam hadir, Flextime, dan WFA telah diverifikasi sesuai rekam jejak sistem.";
      } else {
        existing.directorVerified = true;
        existing.directorVerifierName = currentUser.name;
        existing.directorVerifierRole = currentUser.roleTitle || "Executive Director";
        existing.directorVerifiedAt = nowIso;
        existing.directorNotes = notes?.trim() || "Rekapitulasi Timesheet & Kehadiran disahkan sebagai dokumen resmi periode pelaporan.";
      }
      existing.updatedAt = nowIso;
      sys.workRecapVerifications[key] = existing;
      appendAttendanceAudit(
        draft,
        currentUser,
        "TIMESHEET",
        stage === "finance" ? "Verifikasi Audit Digital Rekap Kerja oleh HR/Finance" : "Pengesahan Audit Digital Rekap Kerja oleh Direktur",
        `${currentUser.name} (${currentUser.roleTitle}) mengesahkan verifikasi audit digital Rekap Kerja untuk ${targetUser?.name || userId} (Periode: ${periodId}).`,
        targetUser?.name
      );
    });
    res.json({ bundle: db.getData().attendanceSystem });
  });
  app.post("/api/reset-data", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== "admin" && currentUser.role !== "director" && !currentUser.permissions?.canManageUsers) {
      return res.status(403).json({
        error: "Akses ditolak: Hanya System Administrator atau Direktur yang berwenang mereset database."
      });
    }
    if (process.env.ALLOW_DESTRUCTIVE_DB_RESET !== "true" || req.body?.confirmPhrase !== "RESET_DATABASE_CONFIRM") {
      db.update((d) => {
        d.auditLogs.unshift({
          id: `log-sec-reset-blocked-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: "Percobaan Reset Database Diblokir (Proteksi Data Operasional)",
          entityType: "USER",
          entityId: "system-db-protection",
          details: `Permintaan reset database ditolak otomatis oleh sistem proteksi produksi untuk melindungi data operasional.`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      });
      return res.status(403).json({
        error: "Fitur reset database dinonaktifkan secara permanen pada mode operasional demi melindungi keutuhan data."
      });
    }
    db.resetToSeed();
    ensureUserSecurityFieldsInitialized();
    res.json({ message: "Database telah direset ke konfigurasi awal" });
  });
  app.use("/api", (err, req, res, _next) => {
    db.rollbackUncommittedChanges();
    const safeErrMsg = String(err?.message || "Unexpected error").replace(/Bearer\s+[^\s]+/gi, "Bearer ***").replace(/(password\s*[=:]\s*)([^\s,;]+)/gi, "$1***");
    console.error(`[API Error] ${req.method} /api${req.path}:`, safeErrMsg);
    if (res.headersSent) return;
    const statusCode = Number(err?.httpStatus || err?.status || 500);
    res.status(statusCode).json({
      error: err?.userMessage || (statusCode === 401 ? "Sesi otentikasi tidak valid atau telah berakhir. Silakan login kembali." : "Terjadi kesalahan pemrosesan pada server saat menyimpan atau memuat data."),
      errorCategory: err?.errorCategory || void 0,
      failedTable: err?.failedTable || void 0,
      mysqlErrorCode: err?.code || void 0
    });
  });
  const distDir = path3.join(__dirname, "dist");
  const distIndexHtml = path3.join(distDir, "index.html");
  const isRunningCompiledServerJs = import.meta.url.endsWith("/server.js") || (process.argv[1] || "").endsWith("/server.js") || (process.argv[1] || "").endsWith("\\server.js");
  const isProductionRuntime = process.env.NODE_ENV === "production" || Boolean(process.env.IN_PASSENGER) || Boolean(process.env.PASSENGER_APP_ENV) || isRunningCompiledServerJs && fs3.existsSync(distIndexHtml);
  if (isProductionRuntime && fs3.existsSync(distIndexHtml)) {
    app.use(
      "/assets",
      express.static(path3.join(distDir, "assets"), {
        dotfiles: "deny",
        immutable: true,
        maxAge: "365d",
        fallthrough: false
      })
    );
    app.use(
      express.static(distDir, {
        dotfiles: "deny",
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith(".html")) {
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
          }
        }
      })
    );
    app.get("*", (req, res) => {
      if (req.path.startsWith("/assets/") || /\.(?:js|mjs|css|map|json|ico|png|jpg|jpeg|svg|webp|woff2?)$/i.test(req.path)) {
        return res.status(404).end();
      }
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.sendFile(distIndexHtml);
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: null
      },
      appType: "spa"
    });
    app.use(vite.middlewares);
  }
  const startListening = (retriesLeft = 5) => {
    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`[NGO System] Server running on http://0.0.0.0:${PORT}`);
    });
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE" && retriesLeft > 0) {
        console.warn(`[NGO System] Port ${PORT} is busy, retrying in 500ms... (${retriesLeft} retries left)`);
        setTimeout(() => {
          server.close();
          startListening(retriesLeft - 1);
        }, 500);
      } else if (err.code === "EADDRINUSE") {
        console.warn(`[NGO System] Port ${PORT} is already serving requests.`);
      } else {
        console.error("Server error:", err);
      }
    });
  };
  startListening();
}
startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
