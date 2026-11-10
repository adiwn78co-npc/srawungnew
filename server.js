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
dotenv.config();
var cachedPool = null;
function isMysqlConfigured() {
  return Boolean(
    process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_DATABASE
  );
}
async function getMysqlPool() {
  if (!isMysqlConfigured()) {
    return null;
  }
  if (cachedPool) {
    return cachedPool;
  }
  const modName = "mysql2/promise";
  const mysqlModule = await import(
    /* @vite-ignore */
    modName
  );
  const mysql = mysqlModule.default || mysqlModule;
  cachedPool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE,
    connectTimeout: 5e3,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });
  return cachedPool;
}
async function ensureMysqlSchema(pool) {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    path.resolve(process.cwd(), "database", "schema.sql"),
    path.resolve(moduleDir, "database", "schema.sql"),
    path.resolve(moduleDir, "..", "..", "database", "schema.sql")
  ];
  const schemaPath = candidatePaths.find((p) => fs.existsSync(p));
  if (!schemaPath) {
    return;
  }
  const sqlContent = fs.readFileSync(schemaPath, "utf-8");
  const cleanedSql = sqlContent.replace(/^\s*--.*$/gm, "");
  const statements = cleanedSql.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
  for (const stmt of statements) {
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
async function loadDatabaseFromMysql(pool, _fallbackSeed) {
  await ensureMysqlSchema(pool);
  const [userRows] = await pool.query("SELECT * FROM users ORDER BY created_at ASC");
  const hasUsers = Array.isArray(userRows) && userRows.length > 0;
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
  const [programRows] = await pool.query("SELECT * FROM programs ORDER BY created_at DESC");
  const [outcomeRows] = await pool.query("SELECT * FROM outcomes");
  const [outputRows] = await pool.query("SELECT * FROM outputs");
  const [activityRows] = await pool.query("SELECT * FROM activities");
  const [subActivityRows] = await pool.query("SELECT * FROM sub_activities");
  const [torRows] = await pool.query("SELECT * FROM tors ORDER BY created_at DESC");
  const [approvalRows] = await pool.query("SELECT * FROM approval_records ORDER BY timestamp ASC");
  const [caRows] = await pool.query("SELECT * FROM cash_advances ORDER BY created_at DESC");
  const [minutesRows] = await pool.query("SELECT * FROM meeting_minutes ORDER BY created_at DESC");
  const [participantRows] = await pool.query("SELECT * FROM participants ORDER BY created_at DESC");
  const [attendanceRows] = await pool.query("SELECT * FROM attendance_records ORDER BY record_date DESC");
  const [auditRows] = await pool.query("SELECT * FROM audit_logs ORDER BY timestamp DESC");
  const [kvRows] = await pool.query("SELECT store_key, store_value FROM system_kv_store");
  const kvMap = {};
  if (Array.isArray(kvRows)) {
    for (const row of kvRows) {
      kvMap[row.store_key] = safeJsonParse(row.store_value, null);
    }
  }
  const parseRowList = (rows) => Array.isArray(rows) ? rows.map((r) => safeJsonParse(r.raw_json, r)) : [];
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
  if (Array.isArray(attendanceRows) && (attendanceRows.length > 0 || Boolean(kvMap["attendanceSystem"]))) {
    attendanceSystem.records = parseRowList(attendanceRows);
  }
  return {
    users: parseRowList(userRows),
    currentUserId: kvMap["currentUserId"] || "user-director",
    programs: parseRowList(programRows),
    outcomes: parseRowList(outcomeRows),
    outputs: parseRowList(outputRows),
    activities: parseRowList(activityRows),
    subActivities: parseRowList(subActivityRows),
    tors: parseRowList(torRows),
    approvalRecords: parseRowList(approvalRows),
    auditLogs: parseRowList(auditRows),
    cashAdvances: parseRowList(caRows),
    cashAdvanceSummaries: kvMap["cashAdvanceSummaries"] || {},
    cashAdvanceAuditLogs: kvMap["cashAdvanceAuditLogs"] || {},
    meetingMinutes: parseRowList(minutesRows),
    activityDocumentations: kvMap["activityDocumentations"] || {},
    activityDocumentationList: kvMap["activityDocumentationList"] || [],
    outputRaciRecords: kvMap["outputRaciRecords"] || {},
    activityMonitoringRecords: kvMap["activityMonitoringRecords"] || {},
    monitoringReports: kvMap["monitoringReports"] || {},
    approvalHubItems: kvMap["approvalHubItems"] || {},
    approvalWorkflowConfigs: kvMap["approvalWorkflowConfigs"] || {},
    approvalNotifications: kvMap["approvalNotifications"] || [],
    programBudgets: kvMap["programBudgets"] || {},
    participantDatabase: parseRowList(participantRows),
    attendanceSystem,
    organizationSettings: kvMap["organizationSettings"] || void 0,
    cleanResetPrj3581V1: kvMap["cleanResetPrj3581V1"] !== void 0 ? Boolean(kvMap["cleanResetPrj3581V1"]) : void 0,
    cleanResetPrj3581V2: kvMap["cleanResetPrj3581V2"] !== void 0 ? Boolean(kvMap["cleanResetPrj3581V2"]) : void 0
  };
}
async function upsertMysqlKvEntries(pool, entries) {
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  for (const [k, v] of Object.entries(entries)) {
    if (v === void 0) continue;
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
async function syncTableById(conn, tableName, rows, insertSql, mapRowParams) {
  const safeRows = Array.isArray(rows) ? rows.filter((r) => r && r.id) : [];
  const currentIds = safeRows.map((r) => String(r.id));
  if (currentIds.length === 0) {
    await conn.query(`DELETE FROM ${tableName}`);
    return;
  }
  const placeholders = currentIds.map(() => "?").join(", ");
  await conn.query(
    `DELETE FROM ${tableName} WHERE id NOT IN (${placeholders})`,
    currentIds
  );
  for (const item of safeRows) {
    await conn.query(insertSql, mapRowParams(item));
  }
}
async function saveDatabaseToMysql(pool, data) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await syncTableById(
      conn,
      "users",
      data.users || [],
      `INSERT INTO users (
        id, username, name, email, password_hash, role, role_title, department,
        is_active, account_status, permissions_json, last_login_at, created_at, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        username = VALUES(username),
        name = VALUES(name),
        email = VALUES(email),
        password_hash = VALUES(password_hash),
        role = VALUES(role),
        role_title = VALUES(role_title),
        department = VALUES(department),
        is_active = VALUES(is_active),
        account_status = VALUES(account_status),
        permissions_json = VALUES(permissions_json),
        last_login_at = VALUES(last_login_at),
        raw_json = VALUES(raw_json)`,
      (u) => [
        String(u.id).slice(0, 128),
        truncStr(u.username, 128),
        truncStr(u.name, 255) || "",
        truncStr(u.email, 255) || "",
        truncStr(u.passwordHash, 255),
        truncStr(u.role, 64) || "staff",
        truncStr(u.roleTitle, 255),
        truncStr(u.department, 255),
        u.isActive === false ? 0 : 1,
        truncStr(u.accountStatus || (u.isActive === false ? "Nonaktif" : "Aktif"), 64),
        JSON.stringify(u.permissions || {}),
        truncStr(u.lastLoginAt, 64),
        truncStr(u.createdAt || (/* @__PURE__ */ new Date()).toISOString(), 64),
        JSON.stringify(u)
      ]
    );
    await syncTableById(
      conn,
      "programs",
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
        truncStr(p.name, 255) || "",
        p.description || null,
        truncStr(p.donor, 255),
        truncStr(p.startDate, 32),
        truncStr(p.endDate, 32),
        Number(p.totalBudget || p.budget || 0),
        truncStr(p.currency || "IDR", 16),
        truncStr(p.status || "Active", 64),
        truncStr(p.createdAt || (/* @__PURE__ */ new Date()).toISOString(), 64),
        JSON.stringify(p)
      ]
    );
    await syncTableById(
      conn,
      "outcomes",
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
        oc.programId || "",
        oc.code || null,
        oc.name || oc.title || "",
        oc.description || null,
        Number(oc.budgetAllocated || oc.budget || 0),
        JSON.stringify(oc)
      ]
    );
    await syncTableById(
      conn,
      "outputs",
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
        op.outcomeId || "",
        op.code || null,
        op.name || op.title || "",
        op.description || null,
        Number(op.budgetAllocated || op.budget || 0),
        JSON.stringify(op)
      ]
    );
    await syncTableById(
      conn,
      "activities",
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
        ac.outputId || "",
        ac.code || null,
        ac.name || ac.title || "",
        ac.description || null,
        Number(ac.budgetAllocated || ac.budget || 0),
        JSON.stringify(ac)
      ]
    );
    await syncTableById(
      conn,
      "sub_activities",
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
        sa.activityId || "",
        sa.code || null,
        sa.name || "",
        sa.description || null,
        Number(sa.budgetAllocated || sa.budget || 0),
        JSON.stringify(sa)
      ]
    );
    await syncTableById(
      conn,
      "tors",
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
        truncStr(t.title, 500) || "",
        truncStr(t.programId, 128),
        truncStr(t.outcomeId, 128),
        truncStr(t.outputId, 128),
        truncStr(t.activityId, 128),
        truncStr(t.createdByUserId || t.createdById, 128),
        truncStr(t.createdByName || t.picName, 255),
        truncStr(t.status || "Draft", 128),
        Number(t.currentWorkflowStage || 1),
        t.budgetRequested != null ? Number(t.budgetRequested) : null,
        t.budgetActualSpent != null ? Number(t.budgetActualSpent) : null,
        truncStr(t.startDate, 32),
        truncStr(t.endDate, 32),
        truncStr(t.location, 255),
        truncStr(t.createdAt || (/* @__PURE__ */ new Date()).toISOString(), 64),
        truncStr(t.updatedAt || (/* @__PURE__ */ new Date()).toISOString(), 64),
        JSON.stringify(t)
      ]
    );
    await syncTableById(
      conn,
      "approval_records",
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
        ar.torId || "",
        ar.stage != null ? Number(ar.stage) : null,
        ar.approverUserId || null,
        ar.approverName || null,
        ar.role || null,
        ar.action || null,
        ar.notes || null,
        ar.timestamp || (/* @__PURE__ */ new Date()).toISOString(),
        JSON.stringify(ar)
      ]
    );
    await syncTableById(
      conn,
      "cash_advances",
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
        ca.status || "Draft",
        ca.reportApprovalStatus || null,
        ca.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
        ca.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
        JSON.stringify(ca)
      ]
    );
    await syncTableById(
      conn,
      "meeting_minutes",
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
        mm.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
        JSON.stringify(mm)
      ]
    );
    await syncTableById(
      conn,
      "participants",
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
      (pt) => [
        pt.id,
        pt.entityType || pt.participantType || "INDIVIDUAL",
        pt.fullName || pt.groupName || pt.name || "",
        pt.gender || null,
        pt.institutionName || pt.groupName || null,
        pt.phoneNumber || pt.contactPhone || null,
        pt.cityOrRegency || pt.villageOrSubdistrict || null,
        pt.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
        JSON.stringify(pt)
      ]
    );
    await syncTableById(
      conn,
      "attendance_records",
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
        att.date || "",
        att.userId || "",
        att.userName || null,
        att.recordType || "ATTENDANCE",
        att.clockInTime || null,
        att.clockOutTime || null,
        Number(att.totalWorkHours || 0),
        att.isOutsideWorkLocation ? 1 : 0,
        att.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
        att.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
        JSON.stringify(att)
      ]
    );
    await syncTableById(
      conn,
      "audit_logs",
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
        truncStr(al.torId || (al.entityType === "TOR" ? al.entityId : null), 128),
        truncStr(al.userId || al.actorId, 128),
        truncStr(al.userName || al.actorName, 255),
        truncStr(al.userRole || al.actorRole, 64),
        truncStr(al.action, 255) || "",
        al.details || null,
        truncStr(al.timestamp || (/* @__PURE__ */ new Date()).toISOString(), 64) || (/* @__PURE__ */ new Date()).toISOString(),
        JSON.stringify(al)
      ]
    );
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
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
function createDefaultSeed() {
  return {
    users: INITIAL_USERS,
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
function normalizeSchema(parsed) {
  if (parsed.cleanResetPrj3581V1 === void 0) {
    parsed.cleanResetPrj3581V1 = true;
  }
  if (parsed.cleanResetPrj3581V2 === void 0) {
    parsed.cleanResetPrj3581V2 = true;
  }
  if (!parsed.currentUserId) {
    parsed.currentUserId = "user-director";
  }
  if (!Array.isArray(parsed.programs)) {
    parsed.programs = [];
  }
  if (!Array.isArray(parsed.users) || parsed.users.length === 0) {
    parsed.users = [...INITIAL_USERS];
  } else {
    const hasAdmin = parsed.users.some(
      (u) => u.role === "admin" || u.permissions?.canManageUsers
    );
    if (!hasAdmin) {
      const defaultAdmin = INITIAL_USERS.find((u) => u.role === "admin");
      if (defaultAdmin) {
        parsed.users.push({ ...defaultAdmin, isActive: true, accountStatus: "Aktif" });
      }
    }
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
var Database = class {
  constructor() {
    this.mysqlWriteChain = Promise.resolve();
    this.initPromise = null;
    this.mysqlStatus = "unconfigured";
    this.isInitializing = false;
    this.ensureDirectory();
    this.data = isMysqlConfigured() ? normalizeSchema(createDefaultSeed()) : this.loadInitialLocalDevData();
    this.initPromise = this.initializeMysqlStorage();
  }
  /**
   * Menunggu hingga proses inisialisasi database selesai sepenuhnya.
   * Jika percobaan sebelumnya gagal (status 'failed'), memanggil ready() akan mencoba menginisialisasi ulang secara aman.
   */
  async ready() {
    if (!this.initPromise || isMysqlConfigured() && this.mysqlStatus === "failed" && !this.isInitializing) {
      this.initPromise = this.initializeMysqlStorage();
    }
    await this.initPromise;
  }
  /**
   * Bernilai true apabila database siap melayani aplikasi:
   * - MySQL tidak dikonfigurasi (mode lokal), ATAU
   * - MySQL berhasil dimuat ('ready'), ATAU
   * - Mode fallback lokal aktif ketika MySQL tidak terjangkau di environment preview (kecuali MYSQL_STRICT_REQUIRED=true).
   */
  isOperational() {
    if (!isMysqlConfigured() || this.mysqlStatus === "ready") {
      return true;
    }
    if (process.env.MYSQL_STRICT_REQUIRED === "true") {
      return false;
    }
    return this.mysqlStatus === "failed";
  }
  /**
   * Menunggu seluruh antrean penulisan asynchronous ke MySQL selesai.
   */
  async flushWrites() {
    await this.mysqlWriteChain;
  }
  ensureDirectory() {
    if (!fs2.existsSync(DATA_DIR)) {
      fs2.mkdirSync(DATA_DIR, { recursive: true });
    }
  }
  persistLocalJsonOnly(snapshot) {
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
   * Hanya digunakan untuk mode fallback development lokal ketika MySQL TIDAK dikonfigurasi
   * atau ketika host MySQL produksi tidak dapat dijangkau dari container preview.
   * Catatan penting: db.backup.json tidak pernah dibaca secara otomatis, dan data ini TIDAK PERNAH ditulis ke MySQL.
   */
  loadInitialLocalDevData() {
    try {
      if (fs2.existsSync(DB_FILE)) {
        const fileContent = fs2.readFileSync(DB_FILE, "utf-8");
        const rawParsed = JSON.parse(fileContent);
        const normalized = normalizeSchema(rawParsed);
        this.persistLocalJsonOnly(normalized);
        return normalized;
      }
    } catch (err) {
      console.warn("[DB] Failed to read local development data/db.json, using default seed:", sanitizeDbError(err));
    }
    const fresh = normalizeSchema(createDefaultSeed());
    this.persistLocalJsonOnly(fresh);
    return fresh;
  }
  async initializeMysqlStorage() {
    if (!isMysqlConfigured()) {
      this.mysqlStatus = "unconfigured";
      return;
    }
    this.isInitializing = true;
    const maxAttempts = 2;
    let lastError = null;
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const pool = await getMysqlPool();
          if (!pool) {
            throw new Error("MySQL connection pool is unavailable.");
          }
          await pool.query("SELECT 1");
          console.log("[DB] MySQL connected successfully.");
          const existingFromMysql = await loadDatabaseFromMysql(pool);
          if (existingFromMysql) {
            const missingFlags = {};
            if (existingFromMysql.cleanResetPrj3581V1 === void 0) {
              missingFlags.cleanResetPrj3581V1 = true;
            }
            if (existingFromMysql.cleanResetPrj3581V2 === void 0) {
              missingFlags.cleanResetPrj3581V2 = true;
            }
            this.data = normalizeSchema(existingFromMysql);
            this.mysqlStatus = "ready";
            if (Object.keys(missingFlags).length > 0) {
              await upsertMysqlKvEntries(pool, missingFlags);
            }
            console.log("[DB] Existing application data loaded from MySQL.");
            return;
          }
          console.log("[DB] Database is empty. Initial seed is being created.");
          const initialSeed = normalizeSchema(createDefaultSeed());
          await saveDatabaseToMysql(pool, initialSeed);
          this.data = initialSeed;
          this.mysqlStatus = "ready";
          console.log("[DB] Initial seed saved successfully to MySQL.");
          return;
        } catch (err) {
          lastError = err;
          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
      }
      this.mysqlStatus = "failed";
      if (process.env.MYSQL_STRICT_REQUIRED !== "true") {
        this.data = this.loadInitialLocalDevData();
      }
      console.warn(`[DB] MySQL connection or initialization failed: ${sanitizeDbError(lastError)}`);
    } finally {
      this.isInitializing = false;
    }
  }
  persistToMysql(snapshot) {
    if (!isMysqlConfigured()) {
      this.persistLocalJsonOnly(snapshot);
      return;
    }
    if (this.mysqlStatus !== "ready") {
      if (process.env.MYSQL_STRICT_REQUIRED !== "true") {
        this.persistLocalJsonOnly(snapshot);
      }
      return;
    }
    const clonedSnapshot = JSON.parse(JSON.stringify(snapshot));
    this.mysqlWriteChain = this.mysqlWriteChain.then(async () => {
      const pool = await getMysqlPool();
      if (!pool) return;
      await saveDatabaseToMysql(pool, clonedSnapshot);
    }).catch((err) => {
      console.warn(`[DB] MySQL connection or initialization failed: ${sanitizeDbError(err)}`);
    });
  }
  getData() {
    return this.data;
  }
  update(updater) {
    updater(this.data);
    this.persistToMysql(this.data);
    return this.data;
  }
  resetToSeed() {
    this.data = normalizeSchema(createDefaultSeed());
    this.persistExplicitBackup(this.data);
    this.persistToMysql(this.data);
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

// server.ts
var __filename = fileURLToPath2(import.meta.url);
var __dirname = path3.dirname(__filename);
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
  const PORT = Number(process.env.PORT) || 3e3;
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "geolocation=*, camera=(), microphone=(), payment=()");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https:; font-src 'self' https://fonts.gstatic.com data: https:; img-src 'self' data: blob: https:; connect-src 'self' ws: wss: https:; frame-ancestors 'self' https://*.google.com https://*.aistudio.google.com https://*.usercontent.goog https://*.run.app;"
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
    let cleaned = val.replace(/\0/g, "").replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
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
  const SESSION_HMAC_SECRET = process.env.SESSION_SECRET || crypto.createHash("sha256").update(`wijna-enterprise-hmac-key:${__dirname}`).digest("hex");
  const SESSION_TTL_MS = 12 * 60 * 60 * 1e3;
  const activeSessions = /* @__PURE__ */ new Map();
  const revokedTokens = /* @__PURE__ */ new Set();
  const loginRateLimits = /* @__PURE__ */ new Map();
  const apiRateLimits = /* @__PURE__ */ new Map();
  function hashPassword(plainPassword) {
    const salt = crypto.randomBytes(16).toString("hex");
    const derived = crypto.scryptSync(plainPassword, salt, 64).toString("hex");
    return `scrypt$${salt}$${derived}`;
  }
  function verifyPassword(plainPassword, storedHash) {
    if (!storedHash || !storedHash.startsWith("scrypt$")) return false;
    const parts = storedHash.split("$");
    if (parts.length !== 3) return false;
    const [, salt, originalHex] = parts;
    try {
      const derived = crypto.scryptSync(plainPassword, salt, 64);
      const originalBuf = Buffer.from(originalHex, "hex");
      if (derived.length !== originalBuf.length) return false;
      return crypto.timingSafeEqual(derived, originalBuf);
    } catch {
      return false;
    }
  }
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
    const isUsingDefaultPassword = isDefaultTestingPasswordHash(user.passwordHash);
    const { passwordHash: _removed, ...safeUser } = user;
    const resolvedStatus = safeUser.accountStatus || (safeUser.isActive === false ? "Nonaktif" : "Aktif");
    return {
      ...safeUser,
      username: safeUser.username || deriveDefaultUsername(safeUser.email, safeUser.name),
      accountStatus: resolvedStatus,
      isActive: resolvedStatus === "Aktif",
      mustChangePassword: Boolean(safeUser.mustChangePassword ?? isUsingDefaultPassword)
    };
  }
  function ensureUserSecurityFieldsInitialized() {
    const current = db.getData();
    const needsInit = (current.users || []).some(
      (u) => !u.passwordHash || !u.username || !u.accountStatus || u.mustChangePassword === void 0
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
    await db.flushWrites();
  }
  function computeTokenHmac(payloadB64, user) {
    const userStateBinding = `${user.id}:${user.role}:${user.accountStatus || "Aktif"}:${user.isActive !== false}:${user.passwordHash || ""}`;
    return crypto.createHmac("sha256", `${SESSION_HMAC_SECRET}:${userStateBinding}`).update(payloadB64).digest();
  }
  function createSessionToken(user) {
    const nowMs = Date.now();
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
    if (!token || revokedTokens.has(token)) {
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
        if (Date.now() > decoded.exp) {
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
  const PUBLIC_API_PATHS = /* @__PURE__ */ new Set([
    "/auth/login",
    "/auth/register",
    "/register",
    "/auth/signup"
  ]);
  app.use("/api", async (req, res, next) => {
    if (!db.isOperational()) {
      await db.ready();
      if (!db.isOperational()) {
        return res.status(503).json({
          error: "Database utama sedang tidak dapat dijangkau. Permintaan ditangguhkan sementara untuk melindungi integritas data."
        });
      }
      ensureUserSecurityFieldsInitialized();
      await db.flushWrites();
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
    if (req.body && typeof req.body === "object") {
      req.body = sanitizePayloadDeep(req.body);
    }
    if (PUBLIC_API_PATHS.has(req.path)) {
      return next();
    }
    const verifiedUser = authenticateBearerToken(req);
    if (!verifiedUser) {
      return res.status(401).json({
        error: "Sesi otentikasi tidak valid atau telah berakhir. Silakan login kembali menggunakan kredensial resmi Anda."
      });
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
  app.post("/api/auth/login", (req, res) => {
    const rawIdentifier = String(req.body?.identifier || req.body?.username || req.body?.email || "").trim().toLowerCase();
    const rawPassword = String(req.body?.password || "");
    if (!rawIdentifier || !rawPassword) {
      return res.status(400).json({
        error: "Username/Email dan Password wajib diisi."
      });
    }
    const clientIp = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "local");
    const rateKey = `${clientIp}:${rawIdentifier}`;
    const nowMs = Date.now();
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
    const data = db.getData();
    const targetUser = data.users.find((u) => {
      const uEmail = (u.email || "").trim().toLowerCase();
      const uUsername = (u.username || deriveDefaultUsername(u.email, u.name)).trim().toLowerCase();
      return uEmail === rawIdentifier || uUsername === rawIdentifier;
    });
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    if (!targetUser) {
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
    const isPasswordValid = verifyPassword(rawPassword, targetUser.passwordHash);
    if (!isPasswordValid) {
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
    db.update((d) => {
      d.currentUserId = targetUser.id;
      const idx = d.users.findIndex((u) => u.id === targetUser.id);
      if (idx !== -1) {
        d.users[idx].lastLoginAt = nowIso;
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
    const sessionToken = createSessionToken(loggedInUser);
    res.json({
      message: `Selamat datang kembali, ${loggedInUser.name}`,
      user: sanitizeUser(loggedInUser),
      token: sessionToken
    });
  });
  app.post("/api/auth/change-password", (req, res) => {
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
    const data = db.getData();
    const targetUser = data.users.find((u) => u.id === currentUser.id);
    if (!targetUser) {
      return res.status(404).json({ error: "Akun pengguna tidak ditemukan." });
    }
    if (!verifyPassword(currentPassword, targetUser.passwordHash)) {
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
    for (const [tok, sess] of activeSessions.entries()) {
      if (sess.userId === currentUser.id) {
        activeSessions.delete(tok);
        revokedTokens.add(tok);
      }
    }
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
      activeSessions.delete(token);
      revokedTokens.add(token);
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
  app.get("/api/auth/current-user", (req, res) => {
    const user = getCurrentUser(req);
    if (user.isActive === false) {
      return res.status(403).json({ error: "Akun pengguna sedang dinonaktifkan." });
    }
    res.json(sanitizeUser(user));
  });
  app.post("/api/auth/switch-user", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== "admin" && !currentUser.permissions?.canManageUsers) {
      return res.status(403).json({
        error: "Fitur peralihan sesi tanpa password telah dinonaktifkan demi keamanan produksi. Silakan login menggunakan kredensial resmi."
      });
    }
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
    const sessionToken = createSessionToken(updatedTarget);
    res.json({
      message: `Berhasil beralih ke ${user.name} (${user.roleTitle})`,
      user: sanitizeUser(updatedTarget),
      token: sessionToken
    });
  });
  app.get("/api/users", (_req, res) => {
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
  app.post("/api/users", (req, res) => {
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
    res.status(201).json(sanitizeUser(newUser));
  });
  app.put("/api/users/:id", (req, res) => {
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
          for (const [token, sess] of activeSessions.entries()) {
            if (sess.userId === id) {
              activeSessions.delete(token);
            }
          }
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
    res.json(sanitizeUser(updatedUser));
  });
  app.post("/api/users/:id/reset-password", (req, res) => {
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
    res.json({
      message: `Password untuk akun "${targetUser.name}" berhasil direset dan dienkripsi.`,
      user: sanitizeUser(updatedUser)
    });
  });
  app.delete("/api/users/:id", (req, res) => {
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
    if (!currentUser.permissions.canManagePrograms && currentUser.role !== "director" && currentUser.role !== "program_manager") {
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
    if (!currentUser.permissions.canManagePrograms && currentUser.role !== "director" && currentUser.role !== "program_manager") {
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
    if (!currentUser.permissions.canManagePrograms && currentUser.role !== "director" && currentUser.role !== "program_manager" && currentUser.role !== "finance" && currentUser.role !== "hr" && currentUser.role !== "admin") {
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
    const newOutcome = {
      id: `out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      programId: program.id,
      programName: program.name,
      outcomeNumber: cleanNumber || void 0,
      name: cleanName,
      description: cleanDesc || cleanName,
      picId: picUser.id,
      picName: picUser.name,
      projectName: program.name,
      status: status || "Belum Dimulai",
      indicators: Array.isArray(indicators) ? indicators : [],
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
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
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
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
    const { outcomeNumber, name, description, picId, projectName, indicators, status } = req.body;
    const data = db.getData();
    const picUser = picId ? data.users.find((u) => u.id === picId) : null;
    let updated = null;
    db.update((d) => {
      const idx = d.outcomes.findIndex((o) => o.id === id);
      if (idx !== -1) {
        const nextNum = outcomeNumber !== void 0 ? String(outcomeNumber).trim() : d.outcomes[idx].outcomeNumber;
        const nextDesc = description !== void 0 ? String(description).trim() : d.outcomes[idx].description;
        const nextName = name !== void 0 && String(name).trim() ? String(name).trim() : nextNum && nextDesc ? `${nextNum}: ${nextDesc}` : d.outcomes[idx].name;
        d.outcomes[idx] = {
          ...d.outcomes[idx],
          outcomeNumber: nextNum || void 0,
          name: nextName,
          description: nextDesc ?? d.outcomes[idx].description,
          picId: picUser ? picUser.id : d.outcomes[idx].picId,
          picName: picUser ? picUser.name : d.outcomes[idx].picName,
          projectName: projectName ?? d.outcomes[idx].projectName,
          indicators: indicators ?? d.outcomes[idx].indicators,
          status: status ?? d.outcomes[idx].status
        };
        updated = d.outcomes[idx];
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
    const { outcomeId, outputNumber, name, description, picId, indicators, status } = req.body;
    const cleanNumber = String(outputNumber || "").trim();
    const cleanDesc = String(description || "").trim();
    const cleanName = String(name || "").trim() || (cleanNumber && cleanDesc ? `${cleanNumber}: ${cleanDesc}` : cleanDesc || cleanNumber);
    if (!outcomeId || !cleanName) {
      return res.status(400).json({ error: "Outcome dan Nomor/Deskripsi Output wajib diisi" });
    }
    const data = db.getData();
    const outcomeExists = data.outcomes.some((o) => o.id === outcomeId);
    if (!outcomeExists) {
      return res.status(400).json({ error: "Outcome yang dipilih tidak valid" });
    }
    const picUser = data.users.find((u) => u.id === picId) || currentUser;
    const newOutput = {
      id: `outp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      outcomeId,
      outputNumber: cleanNumber || void 0,
      name: cleanName,
      description: cleanDesc || cleanName,
      picId: picUser.id,
      picName: picUser.name,
      status: status || "Belum Dimulai",
      indicators: Array.isArray(indicators) ? indicators : [],
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    db.update((d) => {
      d.outputs.push(newOutput);
    });
    res.status(201).json(newOutput);
  });
  app.put("/api/outputs/:id", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== "director" && currentUser.role !== "program_manager" && currentUser.role !== "finance" && currentUser.role !== "meal" && !currentUser.permissions?.canManagePrograms) {
      return res.status(403).json({ error: "Tidak memiliki kewenangan mengubah Output" });
    }
    const { id } = req.params;
    const { outputNumber, name, description, picId, indicators, status, outcomeId } = req.body;
    const data = db.getData();
    const picUser = picId ? data.users.find((u) => u.id === picId) : null;
    let updated = null;
    db.update((d) => {
      const idx = d.outputs.findIndex((o) => o.id === id);
      if (idx !== -1) {
        const nextNum = outputNumber !== void 0 ? String(outputNumber).trim() : d.outputs[idx].outputNumber;
        const nextDesc = description !== void 0 ? String(description).trim() : d.outputs[idx].description;
        const nextName = name !== void 0 && String(name).trim() ? String(name).trim() : nextNum && nextDesc ? `${nextNum}: ${nextDesc}` : d.outputs[idx].name;
        d.outputs[idx] = {
          ...d.outputs[idx],
          outcomeId: outcomeId ?? d.outputs[idx].outcomeId,
          outputNumber: nextNum || void 0,
          name: nextName,
          description: nextDesc ?? d.outputs[idx].description,
          picId: picUser ? picUser.id : d.outputs[idx].picId,
          picName: picUser ? picUser.name : d.outputs[idx].picName,
          indicators: indicators ?? d.outputs[idx].indicators,
          status: status ?? d.outputs[idx].status
        };
        updated = d.outputs[idx];
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
    const outputExists = data.outputs.some((o) => o.id === outputId);
    if (!outputExists) {
      return res.status(400).json({ error: "Output yang dipilih tidak valid" });
    }
    const picUser = data.users.find((u) => u.id === picId) || currentUser;
    const newActivity = {
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      outputId,
      activityNumber: typeof activityNumber === "string" && activityNumber.trim() ? activityNumber.trim() : void 0,
      name,
      code: typeof code === "string" && code.trim() ? code.trim() : void 0,
      description: description || "",
      anticipatedInputs: typeof anticipatedInputs === "string" ? anticipatedInputs.trim() : void 0,
      plannedParticipantsBreakdown: typeof plannedParticipantsBreakdown === "string" ? plannedParticipantsBreakdown.trim() : void 0,
      picId: picUser.id,
      picName: picUser.name,
      startDate: startDate || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      endDate: endDate || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      status: status || "Belum Dimulai",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    db.update((d) => {
      d.activities.push(newActivity);
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
    const picUser = picId ? data.users.find((u) => u.id === picId) : null;
    let updated = null;
    db.update((d) => {
      const idx = d.activities.findIndex((a) => a.id === id);
      if (idx !== -1) {
        const nextCode = code !== void 0 ? typeof code === "string" && code.trim() ? code.trim() : void 0 : d.activities[idx].code;
        d.activities[idx] = {
          ...d.activities[idx],
          outputId: outputId ?? d.activities[idx].outputId,
          activityNumber: activityNumber !== void 0 ? typeof activityNumber === "string" && activityNumber.trim() ? activityNumber.trim() : void 0 : d.activities[idx].activityNumber,
          name: name ?? d.activities[idx].name,
          code: nextCode,
          description: description ?? d.activities[idx].description,
          anticipatedInputs: anticipatedInputs !== void 0 ? typeof anticipatedInputs === "string" ? anticipatedInputs.trim() : "" : d.activities[idx].anticipatedInputs,
          plannedParticipantsBreakdown: plannedParticipantsBreakdown !== void 0 ? typeof plannedParticipantsBreakdown === "string" ? plannedParticipantsBreakdown.trim() : "" : d.activities[idx].plannedParticipantsBreakdown,
          picId: picUser ? picUser.id : d.activities[idx].picId,
          picName: picUser ? picUser.name : d.activities[idx].picName,
          startDate: startDate ?? d.activities[idx].startDate,
          endDate: endDate ?? d.activities[idx].endDate,
          status: status ?? d.activities[idx].status
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
    });
    res.json({ message: "Activity berhasil dihapus" });
  });
  app.post("/api/sub-activities", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== "director" && currentUser.role !== "program_manager" && currentUser.role !== "finance" && currentUser.role !== "meal" && !currentUser.permissions?.canManagePrograms) {
      return res.status(403).json({ error: "Tidak memiliki kewenangan membuat Sub-Activity" });
    }
    const { activityId, name, description, picName, startDate, endDate, status } = req.body;
    if (!activityId || !name) {
      return res.status(400).json({ error: "Activity ID dan Nama Sub-Activity wajib diisi" });
    }
    const newSub = {
      id: `sub-${Date.now()}`,
      activityId,
      name,
      description: description || "",
      picName: picName || "",
      startDate: startDate || "",
      endDate: endDate || "",
      status: status || "Belum Dimulai",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    db.update((d) => {
      d.subActivities.push(newSub);
    });
    res.status(201).json(newSub);
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
  app.get("/api/tors", (req, res) => {
    const currentUser = getCurrentUser(req);
    const data = db.getData();
    let tors = data.tors.map((t) => ({
      ...t,
      budgetRequested: getConnectedBudgetRequested(t, data.cashAdvances)
    }));
    if (currentUser.role === "staff" && !currentUser.permissions.canViewAllTors) {
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
    if (!currentUser.permissions.canCreateTor && currentUser.role === "admin") {
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
    if (currentUser.role === "staff" && !currentUser.permissions.canViewAllTors) {
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
    if (currentUser.role !== "finance" && currentUser.role !== "director" && currentUser.role !== "program_manager" && currentUser.role !== "admin") {
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
  app.get("/api/attendance-system", (req, res) => {
    const currentUser = getCurrentUser(req);
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
          reason: void 0,
          hrNotes: void 0,
          directorNotes: void 0,
          returnReason: void 0
        }
      );
      res.json({
        ...bundle,
        records: redactedRecords,
        leaveRequests: redactedLeaves,
        auditTrail: bundle.auditTrail.filter((a) => a.actorId === currentUser.id)
      });
      return;
    }
    res.json(bundle);
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
    let errMsg = null;
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
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
      const existingIdx = sys.records.findIndex(
        (r) => r.userId === currentUser.id && r.date === targetDate
      );
      const clockInLoc = {
        latitude: lat,
        longitude: lon,
        distanceMeters,
        isOutsideWorkLocation: isOutside,
        locationLabel: isOutside ? `Outside Work Location (${lat.toFixed(4)}, ${lon.toFixed(4)} \u2022 ${distanceMeters}m)` : `${sys.locationConfig.officeName} (${distanceMeters}m)`,
        outsideReason: isOutside ? String(outsideReason).trim() : void 0
      };
      if (existingIdx !== -1) {
        const prev = sys.records[existingIdx];
        const updated = {
          ...prev,
          recordType: "ATTENDANCE",
          clockInTime: prev.clockInTime || nowIso,
          clockInLocation: prev.clockInLocation || clockInLoc,
          isOutsideWorkLocation: prev.isOutsideWorkLocation || isOutside,
          outsideLocationReason: isOutside ? String(outsideReason).trim() : prev.outsideLocationReason,
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
          outsideLocationReason: isOutside ? String(outsideReason).trim() : void 0,
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
    res.json({ record: createdOrUpdated, bundle: db.getData().attendanceSystem });
  });
  app.post("/api/attendance-system/reset-today", (req, res) => {
    const currentUser = getCurrentUser(req);
    const { date } = req.body || {};
    const targetDate = date && String(date).trim() ? String(date).trim() : (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      sys.records = sys.records.filter(
        (r) => !(r.userId === currentUser.id && r.date === targetDate)
      );
    });
    res.json({ bundle: db.getData().attendanceSystem });
  });
  app.post("/api/attendance-system/timesheet", (req, res) => {
    const currentUser = getCurrentUser(req);
    const {
      date,
      timesheetItems
    } = req.body || {};
    const targetDate = date && String(date).trim() ? String(date).trim() : (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    if (!Array.isArray(timesheetItems) || timesheetItems.length === 0) {
      return res.status(400).json({ error: "Timesheet harian harus memuat minimal 1 jenis pekerjaan." });
    }
    let updatedRecord = null;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      const existingIdx = sys.records.findIndex(
        (r) => r.userId === currentUser.id && r.date === targetDate
      );
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
        const nextRec = {
          ...prev,
          recordType: approvedWfa ? "WFA" : prev.recordType,
          totalWorkHours: approvedWfa ? sys.locationConfig.standardDailyHours : prev.totalWorkHours,
          wfaRequestId: approvedWfa?.id || prev.wfaRequestId,
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
    res.json({ record: updatedRecord, bundle: db.getData().attendanceSystem });
  });
  app.post("/api/attendance-system/clock-out", (req, res) => {
    const currentUser = getCurrentUser(req);
    const {
      date,
      latitude,
      longitude,
      outsideReason
    } = req.body || {};
    const targetDate = date && String(date).trim() ? String(date).trim() : (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const lat = Number(latitude);
    const lon = Number(longitude);
    const accuracyMargin = Math.min(200, Math.max(0, Math.round(Number(req.body?.gpsAccuracy) || 0)));
    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ error: "Koordinat lokasi Clock Out tidak valid." });
    }
    let updatedRecord = null;
    let errMsg = null;
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      const idx = sys.records.findIndex(
        (r) => r.userId === currentUser.id && r.date === targetDate
      );
      if (idx === -1 || !sys.records[idx].clockInTime) {
        errMsg = "Anda belum melakukan Clock In pada tanggal ini.";
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
        clockOutTime: nowIso,
        clockOutLocation: clockOutLoc,
        totalWorkHours: computedHours,
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
        `${currentUser.name} melakukan Clock Out pada ${targetDate}. Total jam kerja: ${computedHours} jam (${clockOutLoc.locationLabel}).`,
        currentUser.name
      );
    });
    if (errMsg) {
      return res.status(400).json({ error: errMsg });
    }
    res.json({ record: updatedRecord, bundle: db.getData().attendanceSystem });
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
    db.resetToSeed();
    ensureUserSecurityFieldsInitialized();
    res.json({ message: "Database telah direset ke konfigurasi awal" });
  });
  app.use("/api", (err, _req, res, _next) => {
    console.error("[API Security Error]:", err?.message || "Unexpected error");
    if (res.headersSent) return;
    res.status(err?.status || 500).json({
      error: "Terjadi kesalahan pemrosesan pada server. Silakan periksa kembali data yang dikirimkan."
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
        immutable: true,
        maxAge: "365d",
        fallthrough: false
      })
    );
    app.use(
      express.static(distDir, {
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
