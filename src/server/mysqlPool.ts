import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import type { DatabaseSchema } from './db.ts';

dotenv.config();

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

let cachedPool: MysqlPoolLike | null = null;

export function isMysqlConfigured(): boolean {
  return Boolean(
    process.env.MYSQL_HOST &&
      process.env.MYSQL_USER &&
      process.env.MYSQL_DATABASE
  );
}

/**
 * Membuat koneksi pool MySQL menggunakan mysql2/promise sesuai konfigurasi environment:
 * MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE, MYSQL_PORT
 */
export async function getMysqlPool(): Promise<MysqlPoolLike | null> {
  if (!isMysqlConfigured()) {
    return null;
  }
  if (cachedPool) {
    return cachedPool;
  }

  const modName = 'mysql2/promise';
  const mysqlModule: any = await import(/* @vite-ignore */ modName);
  const mysql = mysqlModule.default || mysqlModule;

  cachedPool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  return cachedPool;
}

/**
 * Menjalankan DDL pembuatan tabel MySQL dari database/schema.sql
 */
export async function ensureMysqlSchema(pool: MysqlPoolLike): Promise<void> {
  const schemaPath = path.resolve(process.cwd(), 'database', 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    return;
  }
  const sqlContent = fs.readFileSync(schemaPath, 'utf-8');
  const statements = sqlContent
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));

  for (const stmt of statements) {
    await pool.query(stmt);
  }
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

/**
 * Membaca seluruh data aplikasi dari tabel-tabel MySQL menggunakan query SELECT
 */
export async function loadDatabaseFromMysql(
  pool: MysqlPoolLike,
  fallbackSeed: DatabaseSchema
): Promise<DatabaseSchema | null> {
  await ensureMysqlSchema(pool);

  const [userRows] = await pool.query('SELECT * FROM users ORDER BY created_at ASC');
  const hasUsers = Array.isArray(userRows) && userRows.length > 0;

  if (!hasUsers) {
    const [progCountRows] = await pool.query('SELECT COUNT(*) AS cnt FROM programs');
    const [torCountRows] = await pool.query('SELECT COUNT(*) AS cnt FROM tors');
    const [kvCountRows] = await pool.query('SELECT COUNT(*) AS cnt FROM system_kv_store');
    const totalExistingRecords =
      Number(progCountRows?.[0]?.cnt || 0) +
      Number(torCountRows?.[0]?.cnt || 0) +
      Number(kvCountRows?.[0]?.cnt || 0);

    if (totalExistingRecords === 0) {
      return null; // Seluruh tabel utama MySQL benar-benar kosong, aman untuk seed satu kali
    }
  }

  const [programRows] = await pool.query('SELECT * FROM programs ORDER BY created_at DESC');
  const [outcomeRows] = await pool.query('SELECT * FROM outcomes');
  const [outputRows] = await pool.query('SELECT * FROM outputs');
  const [activityRows] = await pool.query('SELECT * FROM activities');
  const [subActivityRows] = await pool.query('SELECT * FROM sub_activities');
  const [torRows] = await pool.query('SELECT * FROM tors ORDER BY created_at DESC');
  const [approvalRows] = await pool.query('SELECT * FROM approval_records ORDER BY timestamp ASC');
  const [caRows] = await pool.query('SELECT * FROM cash_advances ORDER BY created_at DESC');
  const [minutesRows] = await pool.query('SELECT * FROM meeting_minutes ORDER BY created_at DESC');
  const [participantRows] = await pool.query('SELECT * FROM participants ORDER BY created_at DESC');
  const [attendanceRows] = await pool.query('SELECT * FROM attendance_records ORDER BY record_date DESC');
  const [auditRows] = await pool.query('SELECT * FROM audit_logs ORDER BY timestamp DESC');
  const [kvRows] = await pool.query('SELECT store_key, store_value FROM system_kv_store');

  const kvMap: Record<string, any> = {};
  if (Array.isArray(kvRows)) {
    for (const row of kvRows) {
      kvMap[row.store_key] = safeJsonParse(row.store_value, null);
    }
  }

  const parseRowList = <T>(rows: any[]): T[] =>
    Array.isArray(rows)
      ? rows.map((r) => safeJsonParse<T>(r.raw_json, r as T))
      : [];

  const attendanceSystem = kvMap['attendanceSystem'] || fallbackSeed.attendanceSystem || {
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

  if (Array.isArray(attendanceRows) && attendanceRows.length > 0) {
    attendanceSystem.records = parseRowList(attendanceRows);
  }

  return {
    users: parseRowList(userRows),
    currentUserId: kvMap['currentUserId'] || fallbackSeed.currentUserId || 'user-director',
    programs: parseRowList(programRows),
    outcomes: parseRowList(outcomeRows),
    outputs: parseRowList(outputRows),
    activities: parseRowList(activityRows),
    subActivities: parseRowList(subActivityRows),
    tors: parseRowList(torRows),
    approvalRecords: parseRowList(approvalRows),
    auditLogs: parseRowList(auditRows),
    cashAdvances: parseRowList(caRows),
    cashAdvanceSummaries: kvMap['cashAdvanceSummaries'] || {},
    cashAdvanceAuditLogs: kvMap['cashAdvanceAuditLogs'] || {},
    meetingMinutes: parseRowList(minutesRows),
    activityDocumentations: kvMap['activityDocumentations'] || {},
    activityDocumentationList: kvMap['activityDocumentationList'] || [],
    outputRaciRecords: kvMap['outputRaciRecords'] || {},
    activityMonitoringRecords: kvMap['activityMonitoringRecords'] || {},
    monitoringReports: kvMap['monitoringReports'] || {},
    approvalHubItems: kvMap['approvalHubItems'] || {},
    approvalWorkflowConfigs: kvMap['approvalWorkflowConfigs'] || {},
    approvalNotifications: kvMap['approvalNotifications'] || [],
    programBudgets: kvMap['programBudgets'] || {},
    participantDatabase: parseRowList(participantRows),
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

async function syncTableById(
  conn: any,
  tableName: string,
  rows: any[],
  insertSql: string,
  mapRowParams: (item: any) => any[]
) {
  const safeRows = Array.isArray(rows) ? rows.filter((r) => r && r.id) : [];
  const currentIds = safeRows.map((r) => String(r.id));

  if (currentIds.length === 0) {
    await conn.query(`DELETE FROM ${tableName}`);
    return;
  }

  const placeholders = currentIds.map(() => '?').join(', ');
  await conn.query(
    `DELETE FROM ${tableName} WHERE id NOT IN (${placeholders})`,
    currentIds
  );

  for (const item of safeRows) {
    await conn.query(insertSql, mapRowParams(item));
  }
}

/**
 * Menyimpan seluruh perubahan data ke tabel-tabel MySQL (INSERT / UPDATE / DELETE)
 */
export async function saveDatabaseToMysql(
  pool: MysqlPoolLike,
  data: DatabaseSchema
): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Tabel users
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
        u.id,
        u.username || null,
        u.name || '',
        u.email || '',
        u.passwordHash || null,
        u.role || 'staff',
        u.roleTitle || null,
        u.department || null,
        u.isActive === false ? 0 : 1,
        u.accountStatus || (u.isActive === false ? 'Nonaktif' : 'Aktif'),
        JSON.stringify(u.permissions || {}),
        u.lastLoginAt || null,
        u.createdAt || new Date().toISOString(),
        JSON.stringify(u),
      ]
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
        p.id,
        p.code || null,
        p.name || '',
        p.description || null,
        p.donor || null,
        p.startDate || null,
        p.endDate || null,
        Number(p.totalBudget || p.budget || 0),
        p.currency || 'IDR',
        p.status || 'Active',
        p.createdAt || new Date().toISOString(),
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
        t.id,
        t.torNumber || null,
        t.title || '',
        t.programId || null,
        t.outcomeId || null,
        t.outputId || null,
        t.activityId || null,
        t.createdByUserId || null,
        t.createdByName || null,
        t.status || 'Draft',
        Number(t.currentWorkflowStage || 1),
        t.budgetRequested != null ? Number(t.budgetRequested) : null,
        t.budgetActualSpent != null ? Number(t.budgetActualSpent) : null,
        t.startDate || null,
        t.endDate || null,
        t.location || null,
        t.createdAt || new Date().toISOString(),
        t.updatedAt || new Date().toISOString(),
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
        al.id,
        al.torId || null,
        al.userId || null,
        al.userName || null,
        al.userRole || null,
        al.action || '',
        al.details || null,
        al.timestamp || new Date().toISOString(),
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
