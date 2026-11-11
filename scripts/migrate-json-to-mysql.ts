import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  getMysqlPool,
  ensureMysqlSchema,
  saveDatabaseToMysql,
  isMysqlConfigured,
} from '../src/server/mysqlPool.ts';
import type { DatabaseSchema } from '../src/server/db.ts';

dotenv.config();

/**
 * Script Migrasi Satu Kali (One-Time Migration):
 * 1. Membaca data/db.json (atau data/db.backup.json)
 * 2. Membuat tabel-tabel MySQL sesuai database/schema.sql
 * 3. Memasukkan seluruh baris ke tabel MySQL dengan INSERT INTO ... ON DUPLICATE KEY UPDATE
 * 4. Membandingkan jumlah baris sebelum (JSON) dan sesudah (MySQL SELECT COUNT(*))
 * 5. Menyimpan data/db.json sebagai backup di data/db.backup.json
 */
async function runMigration() {
  console.log('==============================================================');
  console.log(' WIJNA SRAWUNG — Migrasi Database JSON (db.json) ke MySQL');
  console.log('==============================================================');

  if (!isMysqlConfigured()) {
    console.error(
      'ERROR: Variabel environment MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, dan MYSQL_DATABASE wajib diisi sebelum menjalankan migrasi.'
    );
    process.exit(1);
  }

  const dataDir = path.resolve(process.cwd(), 'data');
  const dbJsonPath = path.resolve(dataDir, 'db.json');
  const backupJsonPath = path.resolve(dataDir, 'db.backup.json');

  const sourcePath = fs.existsSync(dbJsonPath)
    ? dbJsonPath
    : fs.existsSync(backupJsonPath)
    ? backupJsonPath
    : null;

  if (!sourcePath) {
    console.error('ERROR: File data/db.json tidak ditemukan.');
    process.exit(1);
  }

  const rawContent = fs.readFileSync(sourcePath, 'utf-8');
  const jsonData: DatabaseSchema = JSON.parse(rawContent);

  const beforeCounts = {
    users: (jsonData.users || []).length,
    programs: (jsonData.programs || []).length,
    outcomes: (jsonData.outcomes || []).length,
    outputs: (jsonData.outputs || []).length,
    activities: (jsonData.activities || []).length,
    sub_activities: (jsonData.subActivities || []).length,
    tors: (jsonData.tors || []).length,
    approval_records: (jsonData.approvalRecords || []).length,
    cash_advances: (jsonData.cashAdvances || []).length,
    meeting_minutes: (jsonData.meetingMinutes || []).length,
    participants: (jsonData.participantDatabase || []).length,
    attendance_records: (jsonData.attendanceSystem?.records || []).length,
    audit_logs: (jsonData.auditLogs || []).length,
  };

  console.log('\n[1/4] Jumlah Data Sebelum Migrasi (Sumber JSON):');
  console.table(beforeCounts);

  const pool = await getMysqlPool();
  if (!pool) {
    console.error('ERROR: Gagal menginisialisasi pool koneksi MySQL.');
    process.exit(1);
  }

  try {
    console.log('\n[2/4] Memastikan tabel-tabel MySQL tersedia (CREATE TABLE IF NOT EXISTS)...');
    await ensureMysqlSchema(pool);

    const [existingUsers] = await pool.query('SELECT COUNT(*) AS total FROM users');
    const existingUserCount = Number(existingUsers?.[0]?.total || 0);
    if (existingUserCount > 0 && process.env.FORCE_MIGRATE_OVERWRITE !== 'true') {
      console.log(
        `[SAFEGUARD] Tabel users di MySQL sudah berisi ${existingUserCount} akun. Password hash yang sudah ada di MySQL dilindungi dan TIDAK akan ditimpa oleh JSON.`
      );
    }

    console.log('[3/4] Memindahkan data JSON ke tabel MySQL secara aman (INSERT / UPDATE non-destruktif)...');
    await saveDatabaseToMysql(pool, jsonData);

    const tables = Object.keys(beforeCounts) as (keyof typeof beforeCounts)[];
    const comparison: Record<
      string,
      { sebelum_json: number; sesudah_mysql: number; status: string }
    > = {};

    for (const tbl of tables) {
      const [rows] = await pool.query(`SELECT COUNT(*) AS total FROM ${tbl}`);
      const afterCount = Number(rows?.[0]?.total || 0);
      const beforeCount = beforeCounts[tbl];
      comparison[tbl] = {
        sebelum_json: beforeCount,
        sesudah_mysql: afterCount,
        status: afterCount === beforeCount ? 'COCOK (OK)' : 'SELISIH',
      };
    }

    console.log('\n[4/4] Verifikasi Jumlah Data Sebelum vs Sesudah Migrasi:');
    console.table(comparison);

    // Simpan db.json sebagai backup
    if (fs.existsSync(dbJsonPath)) {
      fs.copyFileSync(dbJsonPath, backupJsonPath);
      console.log(`\nBackup berhasil disimpan ke: ${backupJsonPath}`);
    }

    console.log('\nMigrasi dari data/db.json ke MySQL SELESAI dengan sukses!');
  } catch (err: any) {
    console.error('\nMigrasi gagal:', err?.message || err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
