import express, { type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { db } from './src/server/db.ts';
import type {
  User,
  UserAccountStatus,
  Program,
  ProgramStatus,
  Outcome,
  Output,
  Activity,
  SubActivity,
  Tor,
  TorApprovalRecord,
  AuditLog,
  SubmissionStatus,
  CashAdvanceRecord,
  MeetingMinutesRecord,
  ActivityDocumentationRecord,
  OutputRaciRecord,
  ActivityMonitoringRecord,
  SelectedActivityMonitoringTool,
  MonitoringReportItem,
  MonitoringReportSections,
  MonitoringReportStatus,
  MasterParticipantRecord,
  MasterIndividualParticipant,
  MasterGroupParticipant,
  ParticipantProgramInvolvement,
  GroupMemberCompositionMatrix,
  GroupCompositionRowKey,
  WijnaWorkCategory,
  TimesheetWorkItem,
  DailyAttendanceTimesheetRecord,
  FlextimeAssignment,
  LeaveCategoryPolicy,
  LeaveCategoryGroup,
  LeaveRequestRecord,
  WfaRequestRecord,
  HolidayRequestRecord,
  EmployeeTrainingRecord,
  EmployeeTrainingApprovalStatus,
  AttendanceAuditTrailEntry,
} from './src/types/index.ts';
import {
  generateProgramCode,
  getRomanMonth,
  formatTorNumber,
  getTorDraftPreview,
  computeHierarchyCode,
} from './src/lib/torNumberGenerator.ts';
import {
  syncApprovalHubData,
  executeApprovalHubAction,
  resolveUserApprovalAccess,
  filterApprovalItemsForUser,
} from './src/server/approvalHubService.ts';
import {
  ensureAttendanceSystemInitialized,
  calculateDistanceMeters,
  calculateWorkHoursBetween,
  enumerateDatesBetween,
  calculateWorkingDaysBetween,
  resolveAttendanceWorkflowType,
  isAttendanceArrangementActiveOnCalendar,
} from './src/server/attendanceService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Mendapatkan nomor urut TOR berikutnya untuk tahun tertentu.
 * Aturan Sistem:
 * - Nomor urut 3 digit mulai dari 001, global untuk seluruh TOR WIJNA setiap tahun.
 * - Direset menjadi 001 setiap tahun baru.
 * - Tanpa menggunakan kembali nomor yang sudah pernah diterbitkan pada tahun tersebut.
 */
function getNextTorSequenceForYear(data: ReturnType<typeof db.getData>, targetYear: number): number {
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
      if (typeof t.torSequence === 'number' && t.torSequence > maxSeq) {
        maxSeq = t.torSequence;
      }
      if (t.torNumber) {
        // Cocokkan TOR/001/WIJNA/ atau 001/WIJNA/
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
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Security Headers & Body Size Limit (Defense in Depth — compatible with AI Studio Preview iframe)
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=*, camera=(), microphone=(), payment=()');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https:; font-src 'self' https://fonts.gstatic.com data: https:; img-src 'self' data: blob: https:; connect-src 'self' ws: wss: https:; frame-ancestors 'self' https://*.google.com https://*.aistudio.google.com https://*.usercontent.goog https://*.run.app;"
    );
    if (req.path.startsWith('/api')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    next();
  });
  app.use(express.json({ limit: '2mb' }));

  // --- SECURITY: INPUT SANITIZATION (XSS, PROTOTYPE POLLUTION & DANGEROUS URI SCHEMES) ---
  const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  function sanitizeStringValue(val: string, keyName = ''): string {
    let cleaned = val.replace(/\0/g, '').replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    const trimmedLower = cleaned.trim().toLowerCase();
    if (
      trimmedLower.startsWith('javascript:') ||
      trimmedLower.startsWith('vbscript:') ||
      trimmedLower.startsWith('data:text/html')
    ) {
      return '';
    }
    if (/(url|link|href)/i.test(keyName) && cleaned.trim()) {
      const candidate = cleaned.trim();
      if (!/^(https?:\/\/|\/|mailto:)/i.test(candidate)) {
        // Prefix bare domain or reject unsafe protocol
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) {
          return '';
        }
      }
    }
    return cleaned;
  }

  function sanitizePayloadDeep(input: any, keyName = '', depth = 0): any {
    if (depth > 12 || input === null || input === undefined) return input;
    if (typeof input === 'string') {
      return sanitizeStringValue(input, keyName);
    }
    if (Array.isArray(input)) {
      return input.map((item) => sanitizePayloadDeep(item, keyName, depth + 1));
    }
    if (typeof input === 'object') {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(input)) {
        if (DANGEROUS_KEYS.has(k)) continue;
        out[k] = sanitizePayloadDeep(v, k, depth + 1);
      }
      return out;
    }
    return input;
  }

  // --- SECURITY: PASSWORD HASHING, RATE LIMITING & CRYPTOGRAPHIC SESSION MANAGEMENT ---
  const DEFAULT_TESTING_PASSWORD = process.env.DEFAULT_TESTING_PASSWORD || 'Wijna@2026';
  const SESSION_HMAC_SECRET =
    process.env.SESSION_SECRET ||
    crypto.createHash('sha256').update(`wijna-enterprise-hmac-key:${__dirname}`).digest('hex');
  const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 jam masa berlaku sesi
  const activeSessions = new Map<string, { userId: string; createdAt: string }>();
  const revokedTokens = new Set<string>();
  const loginRateLimits = new Map<string, { count: number; firstAttemptAt: number; lockedUntil?: number }>();
  const apiRateLimits = new Map<string, { count: number; windowStart: number }>();

  function hashPassword(plainPassword: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = crypto.scryptSync(plainPassword, salt, 64).toString('hex');
    return `scrypt$${salt}$${derived}`;
  }

  function verifyPassword(plainPassword: string, storedHash?: string): boolean {
    if (!storedHash || !storedHash.startsWith('scrypt$')) return false;
    const parts = storedHash.split('$');
    if (parts.length !== 3) return false;
    const [, salt, originalHex] = parts;
    try {
      const derived = crypto.scryptSync(plainPassword, salt, 64);
      const originalBuf = Buffer.from(originalHex, 'hex');
      if (derived.length !== originalBuf.length) return false;
      return crypto.timingSafeEqual(derived, originalBuf);
    } catch {
      return false;
    }
  }

  function deriveDefaultUsername(email: string, name: string): string {
    const fromEmail = (email || '').split('@')[0]?.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (fromEmail) return fromEmail;
    return (name || 'user')
      .split(',')[0]
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '');
  }

  function sanitizeUser(user: User): User {
    const isUsingDefaultPassword = verifyPassword(DEFAULT_TESTING_PASSWORD, user.passwordHash);
    const { passwordHash: _removed, ...safeUser } = user;
    const resolvedStatus: UserAccountStatus =
      safeUser.accountStatus || (safeUser.isActive === false ? 'Nonaktif' : 'Aktif');
    return {
      ...safeUser,
      username: safeUser.username || deriveDefaultUsername(safeUser.email, safeUser.name),
      accountStatus: resolvedStatus,
      isActive: resolvedStatus === 'Aktif',
      mustChangePassword: Boolean(safeUser.mustChangePassword ?? isUsingDefaultPassword),
    };
  }

  // Pastikan seluruh akun yang ada memiliki username, accountStatus, dan passwordHash terenkripsi
  function ensureUserSecurityFieldsInitialized() {
    const current = db.getData();
    const needsInit = (current.users || []).some(
      (u) => !u.passwordHash || !u.username || !u.accountStatus || u.mustChangePassword === undefined
    );
    if (!needsInit) return;

    const defaultHash = hashPassword(DEFAULT_TESTING_PASSWORD);
    db.update((draft) => {
      const usedUsernames = new Set<string>();
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
          u.accountStatus = u.isActive === false ? 'Nonaktif' : 'Aktif';
        }
        u.isActive = u.accountStatus === 'Aktif';
        if (!u.passwordHash) {
          u.passwordHash = defaultHash;
          u.passwordUpdatedAt = u.createdAt || new Date().toISOString();
          u.mustChangePassword = true;
        } else if (u.mustChangePassword === undefined) {
          u.mustChangePassword = verifyPassword(DEFAULT_TESTING_PASSWORD, u.passwordHash);
        }
      }
    });
  }

  ensureUserSecurityFieldsInitialized();

  // Cryptographic HMAC-SHA256 Session Token (bound to user passwordHash, role, and active status)
  function computeTokenHmac(payloadB64: string, user: User): Buffer {
    const userStateBinding = `${user.id}:${user.role}:${user.accountStatus || 'Aktif'}:${user.isActive !== false}:${user.passwordHash || ''}`;
    return crypto
      .createHmac('sha256', `${SESSION_HMAC_SECRET}:${userStateBinding}`)
      .update(payloadB64)
      .digest();
  }

  function createSessionToken(user: User): string {
    const nowMs = Date.now();
    const payload = {
      uid: user.id,
      jti: crypto.randomBytes(16).toString('hex'),
      iat: nowMs,
      exp: nowMs + SESSION_TTL_MS,
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
    const sigHex = computeTokenHmac(payloadB64, user).toString('hex');
    const token = `${payloadB64}.${sigHex}`;
    activeSessions.set(token, { userId: user.id, createdAt: new Date(nowMs).toISOString() });
    return token;
  }

  function authenticateBearerToken(req: Request): User | null {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    const token = authHeader.slice(7).trim();
    if (!token || revokedTokens.has(token)) {
      return null;
    }
    const data = db.getData();

    // 1. Verify HMAC-signed token format (payloadB64.sigHex)
    if (token.includes('.')) {
      const parts = token.split('.');
      if (parts.length !== 2) return null;
      const [payloadB64, sigHex] = parts;
      try {
        const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
        if (!decoded || typeof decoded.uid !== 'string' || typeof decoded.exp !== 'number') {
          return null;
        }
        if (Date.now() > decoded.exp) {
          activeSessions.delete(token);
          return null;
        }
        const user = data.users.find((u) => u.id === decoded.uid);
        if (!user || user.isActive === false || user.accountStatus === 'Nonaktif' || user.accountStatus === 'Ditangguhkan') {
          return null;
        }
        const expectedSig = computeTokenHmac(payloadB64, user);
        const providedSig = Buffer.from(sigHex, 'hex');
        if (expectedSig.length !== providedSig.length || !crypto.timingSafeEqual(expectedSig, providedSig)) {
          return null;
        }
        return user;
      } catch {
        return null;
      }
    }

    // 2. Fallback check for legacy in-memory session tokens in the same process
    const session = activeSessions.get(token);
    if (session) {
      const ageMs = Date.now() - new Date(session.createdAt).getTime();
      if (ageMs > SESSION_TTL_MS) {
        activeSessions.delete(token);
        return null;
      }
      const sessionUser = data.users.find((u) => u.id === session.userId);
      if (sessionUser && sessionUser.isActive !== false && sessionUser.accountStatus !== 'Nonaktif' && sessionUser.accountStatus !== 'Ditangguhkan') {
        return sessionUser;
      }
    }
    return null;
  }

  // Zero-Trust API Security Gate (Enforces Rate Limiting, Deep Sanitization, and Strict Authentication on /api/*)
  const PUBLIC_API_PATHS = new Set([
    '/auth/login',
    '/auth/register',
    '/register',
    '/auth/signup',
  ]);

  app.use('/api', (req: Request, res: Response, next: express.NextFunction) => {
    // 1. Sliding-Window API Rate Limiting (300 requests / minute per IP)
    const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local');
    const nowMs = Date.now();
    const rateWindow = apiRateLimits.get(clientIp);
    if (!rateWindow || nowMs - rateWindow.windowStart > 60_000) {
      apiRateLimits.set(clientIp, { count: 1, windowStart: nowMs });
    } else {
      rateWindow.count += 1;
      if (rateWindow.count > 300) {
        return res.status(429).json({
          error: 'Terlalu banyak permintaan API dari jaringan Anda. Silakan tunggu beberapa saat.',
        });
      }
    }

    // 2. Deep Payload & Query Sanitization
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizePayloadDeep(req.body);
    }

    // 3. Public Auth Endpoints Exemption
    if (PUBLIC_API_PATHS.has(req.path)) {
      return next();
    }

    // 4. Strict Zero-Trust Bearer Token Verification (No x-user-id header fallback allowed)
    const verifiedUser = authenticateBearerToken(req);
    if (!verifiedUser) {
      return res.status(401).json({
        error: 'Sesi otentikasi tidak valid atau telah berakhir. Silakan login kembali menggunakan kredensial resmi Anda.',
      });
    }

    (req as any).authenticatedUser = verifiedUser;
    next();
  });

  // Helper: get current authenticated user from verified request context
  function getCurrentUser(req: Request): User {
    const verified = (req as any).authenticatedUser || authenticateBearerToken(req);
    if (!verified) {
      throw Object.assign(new Error('Unauthorized access attempt.'), { status: 401 });
    }
    return verified;
  }

  // Helper: verify whether a user is authorized to view/access a specific TOR record
  function canUserAccessTorRecord(
    user: User,
    tor: Tor,
    data: ReturnType<typeof db.getData>
  ): boolean {
    if (user.role !== 'staff' || user.permissions?.canViewAllTors) {
      return true;
    }
    if (tor.picId === user.id || tor.createdById === user.id) {
      return true;
    }
    const raci = data.outputRaciRecords?.[tor.outputId];
    if (
      raci &&
      (raci.responsibleUserId === user.id ||
        raci.accountableUserId === user.id ||
        raci.accountableFinanceUserId === user.id ||
        (raci.consultedUsers || []).includes(user.name) ||
        (raci.informedUsers || []).includes(user.name))
    ) {
      return true;
    }
    return false;
  }

  // Helper: compute total funds requested from ACC'd Cash Advances (Disetujui / Dicairkan) for a TOR
  function getConnectedBudgetRequested(
    tor: Tor,
    cashAdvances: CashAdvanceRecord[] = []
  ): number | null {
    const approvedCas = (cashAdvances || []).filter(
      (ca) => ca.torId === tor.id && (ca.status === 'Disetujui' || ca.status === 'Dicairkan')
    );
    if (approvedCas.length > 0) {
      return approvedCas.reduce((sum, ca) => sum + (Number(ca.totalAmount) || 0), 0);
    }
    return 0;
  }

  function syncTorBudgetInDraft(draft: ReturnType<typeof db.getData>, torId: string) {
    const torIdx = (draft.tors || []).findIndex((t) => t.id === torId);
    if (torIdx === -1) return;
    const approvedCas = (draft.cashAdvances || []).filter(
      (ca) => ca.torId === torId && (ca.status === 'Disetujui' || ca.status === 'Dicairkan')
    );
    draft.tors[torIdx].budgetRequested = approvedCas.reduce(
      (sum, ca) => sum + (Number(ca.totalAmount) || 0),
      0
    );
    const verifiedReportCas = approvedCas.filter(
      (ca) => ca.isReported && ca.reportApprovalStatus === 'Telah Disetujui'
    );
    draft.tors[torIdx].budgetActualSpent = verifiedReportCas.reduce(
      (sum, ca) => sum + (Number(ca.realizedAmount ?? ca.totalAmount) || 0),
      0
    );
  }

  // --- AUTH & USER APIS ---

  function normalizeRolePermissions(
    role: User['role'],
    rawPermissions?: Partial<User['permissions']>
  ): User['permissions'] {
    const defaults: Record<User['role'], User['permissions']> = {
      admin: {
        canManagePrograms: false,
        canCreateTor: false,
        canApproveTor: false,
        canManageUsers: true,
        canViewAllTors: true,
      },
      director: {
        canManagePrograms: true,
        canCreateTor: true,
        canApproveTor: true,
        canManageUsers: false,
        canViewAllTors: true,
      },
      hr: {
        canManagePrograms: false,
        canCreateTor: true,
        canApproveTor: false,
        canManageUsers: false,
        canViewAllTors: true,
      },
      finance: {
        canManagePrograms: false,
        canCreateTor: true,
        canApproveTor: true,
        canManageUsers: false,
        canViewAllTors: true,
      },
      program_manager: {
        canManagePrograms: true,
        canCreateTor: true,
        canApproveTor: true,
        canManageUsers: false,
        canViewAllTors: true,
      },
      meal: {
        canManagePrograms: true,
        canCreateTor: true,
        canApproveTor: false,
        canManageUsers: false,
        canViewAllTors: true,
      },
      staff: {
        canManagePrograms: false,
        canCreateTor: true,
        canApproveTor: false,
        canManageUsers: false,
        canViewAllTors: false,
      },
    };
    const base = defaults[role] || defaults.staff;
    const merged: User['permissions'] = {
      canManagePrograms: rawPermissions?.canManagePrograms ?? base.canManagePrograms,
      canCreateTor: rawPermissions?.canCreateTor ?? base.canCreateTor,
      canApproveTor: rawPermissions?.canApproveTor ?? base.canApproveTor,
      canManageUsers: rawPermissions?.canManageUsers ?? base.canManageUsers,
      canViewAllTors: rawPermissions?.canViewAllTors ?? base.canViewAllTors,
    };
    // Admin hanya untuk konfigurasi pengguna & tidak memiliki wewenang persetujuan operasional
    if (role === 'admin') {
      merged.canApproveTor = false;
      merged.canManageUsers = true;
    }
    return merged;
  }

  /**
   * Sinkronisasi menyeluruh perubahan identitas pengguna (Nama, Jabatan, Role)
   * ke seluruh modul terkait: Monitoring Tools (RACI & Activity Monitoring),
   * Program Structure, ToR, Cash Advance, Attendance, dan Approval Hub.
   */
  function cascadeSyncUserIdentityAcrossSystem(
    draft: ReturnType<typeof db.getData>,
    updatedUser: User,
    previousName: string
  ) {
    const nameChanged = previousName && previousName !== updatedUser.name;

    // 1. Sinkronkan Output RACI Records (Monitoring Tools)
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
          raci.consultedUsers = raci.consultedUsers.map((cName) =>
            cName === previousName ? updatedUser.name : cName
          );
        }
        if (nameChanged && Array.isArray(raci.informedUsers)) {
          raci.informedUsers = raci.informedUsers.map((iName) =>
            iName === previousName ? updatedUser.name : iName
          );
        }
      }
    }

    // 2. Sinkronkan Activity Monitoring Records
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

    // 3. Sinkronkan Monitoring Reports
    if (draft.monitoringReports) {
      for (const rep of Object.values(draft.monitoringReports)) {
        if (rep.responsibleUserId === updatedUser.id || (nameChanged && rep.responsibleName === previousName)) {
          rep.responsibleName = updatedUser.name;
        }
        if (rep.updatedById === updatedUser.id) {
          rep.updatedByName = updatedUser.name;
        }
      }
    }

    // 4. Sinkronkan Hierarki Program -> Outcome -> Output -> Activity -> SubActivity
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

    // 5. Sinkronkan ToR & Cash Advance
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

    // 6. Sinkronkan Attendance & Timesheet Records
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

  // Closed Registration System: Blokir percobaan registrasi mandiri melalui API publik
  const handleBlockedPublicRegistration = (req: Request, res: Response) => {
    const attemptedEmail = String(req.body?.email || req.body?.username || 'Tidak diketahui').trim();
    db.update((d) => {
      d.auditLogs.unshift({
        id: `log-sec-reg-${Date.now()}`,
        actorId: 'anonymous',
        actorName: 'Akses Eksternal / Publik',
        actorRole: 'Unauthenticated',
        action: 'Percobaan Registrasi Mandiri Ditolak',
        entityType: 'USER',
        entityId: 'closed-registration',
        details: `Percobaan pembuatan akun publik ditolak untuk identitas "${attemptedEmail}". Sistem menerapkan Closed Registration System (hanya System Administrator yang berwenang membuat akun).`,
        timestamp: new Date().toISOString(),
      });
    });
    return res.status(403).json({
      error:
        'Pendaftaran akun mandiri ditutup (Closed Registration System). Seluruh akun pengguna dikelola secara eksklusif oleh System Administrator WIJNA.',
    });
  };

  app.post('/api/auth/register', handleBlockedPublicRegistration);
  app.post('/api/register', handleBlockedPublicRegistration);
  app.post('/api/auth/signup', handleBlockedPublicRegistration);

  // Autentikasi Login Pengguna (Username / Email + Password Terenkripsi + Rate Limiting)
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const rawIdentifier = String(req.body?.identifier || req.body?.username || req.body?.email || '')
      .trim()
      .toLowerCase();
    const rawPassword = String(req.body?.password || '');

    if (!rawIdentifier || !rawPassword) {
      return res.status(400).json({
        error: 'Username/Email dan Password wajib diisi.',
      });
    }

    const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local');
    const rateKey = `${clientIp}:${rawIdentifier}`;
    const nowMs = Date.now();
    const rateEntry = loginRateLimits.get(rateKey);
    if (rateEntry?.lockedUntil && nowMs < rateEntry.lockedUntil) {
      const waitSec = Math.ceil((rateEntry.lockedUntil - nowMs) / 1000);
      return res.status(429).json({
        error: `Terlalu banyak percobaan login yang gagal. Silakan tunggu ${waitSec} detik sebelum mencoba kembali.`,
      });
    }

    const recordFailedAttempt = () => {
      const prev = loginRateLimits.get(rateKey);
      const windowMs = 15 * 60 * 1000;
      if (!prev || nowMs - prev.firstAttemptAt > windowMs) {
        loginRateLimits.set(rateKey, { count: 1, firstAttemptAt: nowMs });
      } else {
        const nextCount = prev.count + 1;
        loginRateLimits.set(rateKey, {
          count: nextCount,
          firstAttemptAt: prev.firstAttemptAt,
          lockedUntil: nextCount >= 10 ? nowMs + 5 * 60 * 1000 : undefined,
        });
      }
    };

    const data = db.getData();
    const targetUser = data.users.find((u) => {
      const uEmail = (u.email || '').trim().toLowerCase();
      const uUsername = (u.username || deriveDefaultUsername(u.email, u.name)).trim().toLowerCase();
      return uEmail === rawIdentifier || uUsername === rawIdentifier;
    });

    const nowIso = new Date().toISOString();

    if (!targetUser) {
      recordFailedAttempt();
      db.update((d) => {
        d.auditLogs.unshift({
          id: `log-login-fail-${Date.now()}`,
          actorId: 'anonymous',
          actorName: rawIdentifier,
          actorRole: 'Unauthenticated',
          action: 'Percobaan Login Gagal',
          entityType: 'USER',
          entityId: 'auth-login',
          details: `Percobaan login gagal: Username atau email "${rawIdentifier}" tidak ditemukan dalam sistem.`,
          timestamp: nowIso,
        });
      });
      return res.status(401).json({
        error: 'Kredensial tidak valid. Periksa kembali Username/Email dan Password Anda.',
      });
    }

    const resolvedStatus: UserAccountStatus =
      targetUser.accountStatus || (targetUser.isActive === false ? 'Nonaktif' : 'Aktif');

    if (resolvedStatus !== 'Aktif' || targetUser.isActive === false) {
      db.update((d) => {
        d.auditLogs.unshift({
          id: `log-login-blocked-${Date.now()}`,
          actorId: targetUser.id,
          actorName: targetUser.name,
          actorRole: targetUser.roleTitle,
          action: 'Percobaan Login Akun Nonaktif/Ditangguhkan',
          entityType: 'USER',
          entityId: targetUser.id,
          details: `Percobaan login ditolak karena status akun "${targetUser.name}" sedang ${resolvedStatus}.`,
          timestamp: nowIso,
        });
      });
      return res.status(403).json({
        error:
          resolvedStatus === 'Ditangguhkan'
            ? `Akun "${targetUser.name}" sedang ditangguhkan sementara (Suspended). Silakan hubungi System Administrator.`
            : `Akun "${targetUser.name}" telah dinonaktifkan. Silakan hubungi System Administrator.`,
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
          action: 'Percobaan Login Gagal (Password Salah)',
          entityType: 'USER',
          entityId: targetUser.id,
          details: `Percobaan login gagal untuk akun ${targetUser.name} (${targetUser.email}): Password tidak sesuai.`,
          timestamp: nowIso,
        });
      });
      return res.status(401).json({
        error: 'Kredensial tidak valid. Periksa kembali Username/Email dan Password Anda.',
      });
    }

    loginRateLimits.delete(rateKey);

    let loggedInUser: User = targetUser;
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
        action: 'Login Sistem Berhasil',
        entityType: 'USER',
        entityId: targetUser.id,
        details: `Pengguna ${targetUser.name} (${targetUser.roleTitle} · ${targetUser.department}) berhasil login ke sistem.`,
        timestamp: nowIso,
      });
    });

    const sessionToken = createSessionToken(loggedInUser);

    res.json({
      message: `Selamat datang kembali, ${loggedInUser.name}`,
      user: sanitizeUser(loggedInUser),
      token: sessionToken,
    });
  });

  // Ganti Password Mandiri oleh Pengguna yang Sedang Login (Termasuk System Administrator Default)
  app.post('/api/auth/change-password', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (!currentUser || currentUser.isActive === false) {
      return res.status(401).json({ error: 'Sesi pengguna tidak valid atau akun sedang nonaktif.' });
    }

    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '').trim();

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: 'Password saat ini dan password baru wajib diisi.',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        error: 'Password baru minimal harus terdiri dari 6 karakter.',
      });
    }

    const data = db.getData();
    const targetUser = data.users.find((u) => u.id === currentUser.id);
    if (!targetUser) {
      return res.status(404).json({ error: 'Akun pengguna tidak ditemukan.' });
    }

    if (!verifyPassword(currentPassword, targetUser.passwordHash)) {
      return res.status(401).json({
        error: 'Password saat ini yang Anda masukkan tidak sesuai.',
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        error: 'Password baru harus berbeda dari password saat ini.',
      });
    }

    const nowIso = new Date().toISOString();
    const newHash = hashPassword(newPassword);
    let updatedUser: User = targetUser;

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
        action: 'Perubahan Password Akun Mandiri',
        entityType: 'USER',
        entityId: currentUser.id,
        details: `Pengguna ${currentUser.name} (@${
          currentUser.username || deriveDefaultUsername(currentUser.email, currentUser.name)
        } · ${currentUser.roleTitle}) telah mengganti password akunnya secara mandiri.`,
        timestamp: nowIso,
      });
    });

    // Revoke old in-memory tokens for this user and issue a fresh HMAC token bound to the new passwordHash
    for (const [tok, sess] of activeSessions.entries()) {
      if (sess.userId === currentUser.id) {
        activeSessions.delete(tok);
        revokedTokens.add(tok);
      }
    }
    const freshToken = createSessionToken(updatedUser);

    res.json({
      message: 'Password akun Anda berhasil diperbarui dan dienkripsi.',
      user: sanitizeUser(updatedUser),
      token: freshToken,
    });
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
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
          action: 'Logout Sistem',
          entityType: 'USER',
          entityId: currentUser.id,
          details: `Pengguna ${currentUser.name} (${currentUser.roleTitle}) keluar dari sesi sistem.`,
          timestamp: new Date().toISOString(),
        });
      });
    }
    res.json({ message: 'Sesi berhasil diakhiri.' });
  });

  app.get('/api/auth/current-user', (req: Request, res: Response) => {
    const user = getCurrentUser(req);
    if (user.isActive === false) {
      return res.status(403).json({ error: 'Akun pengguna sedang dinonaktifkan.' });
    }
    res.json(sanitizeUser(user));
  });

  app.post('/api/auth/switch-user', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== 'admin' && !currentUser.permissions?.canManageUsers) {
      return res.status(403).json({
        error: 'Fitur peralihan sesi tanpa password telah dinonaktifkan demi keamanan produksi. Silakan login menggunakan kredensial resmi.',
      });
    }
    const { userId } = req.body;
    const data = db.getData();
    const user = data.users.find((u) => u.id === userId);
    if (!user) {
      return res.status(404).json({ error: 'Pengguna tidak ditemukan' });
    }
    if (user.isActive === false) {
      return res.status(403).json({
        error: `Akun "${user.name}" sedang ${user.accountStatus || 'dinonaktifkan'} dan tidak dapat digunakan untuk mengakses sistem.`,
      });
    }
    const nowIso = new Date().toISOString();
    let updatedTarget: User = user;

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
      token: sessionToken,
    });
  });

  app.get('/api/users', (_req: Request, res: Response) => {
    const data = db.getData();
    res.json((data.users || []).map(sanitizeUser));
  });

  app.get('/api/organization-settings', (_req: Request, res: Response) => {
    const data = db.getData() as any;
    const orgSettings = data.organizationSettings || {
      organizationName: 'Yayasan Inti Muda Indonesia (WIJNA)',
      sidebarBrandName: 'Yayasan Inti Muda Indonesia (WIJNA)',
      sidebarSubtitle: 'HR & Program System',
    };
    res.json(orgSettings);
  });

  app.put('/api/organization-settings', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (
      currentUser.role !== 'admin' &&
      currentUser.role !== 'director' &&
      !currentUser.permissions?.canManageUsers
    ) {
      return res.status(403).json({
        error: 'Akses ditolak: Hanya System Administrator atau Direktur yang berwenang mengubah pengaturan organisasi terpusat.',
      });
    }
    const body = req.body || {};
    const organizationName =
      String(body.organizationName || '').trim() || 'Yayasan Inti Muda Indonesia (WIJNA)';
    const sidebarBrandName =
      String(body.sidebarBrandName || '').trim() || organizationName;
    const sidebarSubtitle =
      String(body.sidebarSubtitle || '').trim() || 'HR & Program System';
    const nowIso = new Date().toISOString();

    let savedSettings: any = null;
    db.update((draft: any) => {
      savedSettings = {
        organizationName,
        sidebarBrandName,
        sidebarSubtitle,
        updatedAt: nowIso,
        updatedByName: body.updatedByName || currentUser.name,
      };
      draft.organizationSettings = savedSettings;
      if (Array.isArray(draft.cashAdvances)) {
        draft.cashAdvances.forEach((ca: any) => {
          ca.organizationName = organizationName;
        });
      }
      draft.auditLogs.unshift({
        id: `log-org-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.role,
        action: 'Pengaturan Nama Organisasi Terpusat',
        entityType: 'USER',
        entityId: 'system',
        details: `Memperbarui nama organisasi terpusat menjadi "${organizationName}" (Sidebar: "${sidebarBrandName}").`,
        timestamp: nowIso,
      });
    });

    res.json(savedSettings);
  });

  app.post('/api/users', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.isActive === false) {
      return res.status(403).json({ error: 'Akun Anda sedang nonaktif.' });
    }
    if (currentUser.role !== 'admin' && !currentUser.permissions?.canManageUsers) {
      db.update((d) => {
        d.auditLogs.unshift({
          id: `log-unauth-create-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: 'Percobaan Pembuatan Akun Tanpa Otorisasi',
          entityType: 'USER',
          entityId: 'unauthorized',
          details: `Pengguna ${currentUser.name} (${currentUser.roleTitle}) mencoba membuat akun baru tanpa hak akses System Administrator.`,
          timestamp: new Date().toISOString(),
        });
      });
      return res.status(403).json({
        error: 'Akses ditolak: Hanya System Administrator yang berwenang membuat akun pengguna baru.',
      });
    }

    const rawName = String(req.body?.name || '').trim();
    const rawEmail = String(req.body?.email || '').trim().toLowerCase();
    const rawUsernameInput = String(req.body?.username || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '');
    const rawInitialPassword = String(req.body?.initialPassword || '').trim();
    const role = req.body?.role as User['role'];
    const rawRoleTitle = String(req.body?.roleTitle || '').trim();
    const rawDepartment = String(req.body?.department || '').trim();
    const rawPermissions = req.body?.permissions;
    const rawAccountStatus = req.body?.accountStatus as UserAccountStatus | undefined;

    if (!rawName || !rawEmail || !role) {
      return res.status(400).json({ error: 'Nama lengkap, email, dan peran wajib diisi.' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      return res.status(400).json({ error: 'Format alamat email tidak valid.' });
    }

    const resolvedUsername = rawUsernameInput || deriveDefaultUsername(rawEmail, rawName);
    if (!resolvedUsername || resolvedUsername.length < 3) {
      return res.status(400).json({
        error: 'Username minimal terdiri dari 3 karakter (huruf/angka/titik/garis bawah).',
      });
    }

    const passwordToHash = rawInitialPassword || DEFAULT_TESTING_PASSWORD;
    if (passwordToHash.length < 6) {
      return res.status(400).json({
        error: 'Password awal minimal harus terdiri dari 6 karakter.',
      });
    }

    const validRoles: User['role'][] = [
      'admin',
      'director',
      'hr',
      'finance',
      'program_manager',
      'meal',
      'staff',
    ];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Role pengguna tidak dikenali oleh sistem.' });
    }

    const currentData = db.getData();
    const duplicateEmail = currentData.users.find(
      (u) => u.email.trim().toLowerCase() === rawEmail
    );
    if (duplicateEmail) {
      return res.status(400).json({
        error: `Email "${rawEmail}" sudah terdaftar atas nama ${duplicateEmail.name}. Gunakan email yang berbeda.`,
      });
    }

    const duplicateUsername = currentData.users.find(
      (u) =>
        (u.username || deriveDefaultUsername(u.email, u.name)).trim().toLowerCase() ===
        resolvedUsername
    );
    if (duplicateUsername) {
      return res.status(400).json({
        error: `Username "${resolvedUsername}" sudah digunakan oleh ${duplicateUsername.name}. Gunakan username unik.`,
      });
    }

    const duplicateName = currentData.users.find(
      (u) => u.name.trim().toLowerCase() === rawName.toLowerCase()
    );
    if (duplicateName) {
      return res.status(400).json({
        error: `Pengguna dengan nama "${rawName}" sudah terdaftar (${duplicateName.email}). Hindari pembuatan akun ganda.`,
      });
    }

    const resolvedStatus: UserAccountStatus =
      rawAccountStatus && ['Aktif', 'Ditangguhkan', 'Nonaktif'].includes(rawAccountStatus)
        ? rawAccountStatus
        : req.body?.isActive === false
        ? 'Nonaktif'
        : 'Aktif';

    const nowIso = new Date().toISOString();
    const newUser: User = {
      id: `user-${Date.now()}`,
      username: resolvedUsername,
      name: rawName,
      email: rawEmail,
      role,
      roleTitle: rawRoleTitle || role.toUpperCase(),
      department: rawDepartment || 'Staf Lapangan',
      accountStatus: resolvedStatus,
      isActive: resolvedStatus === 'Aktif',
      permissions: normalizeRolePermissions(role, rawPermissions),
      createdAt: nowIso,
      passwordUpdatedAt: nowIso,
      passwordHash: hashPassword(passwordToHash),
      mustChangePassword: true,
    };

    db.update((d) => {
      d.users.push(newUser);
      d.auditLogs.unshift({
        id: `log-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: 'Pembuatan Akun Pengguna',
        entityType: 'USER',
        entityId: newUser.id,
        details: `Membuat akun baru: ${newUser.name} (@${newUser.username} · ${newUser.roleTitle} · ${newUser.department}) dengan status ${resolvedStatus}.`,
        timestamp: nowIso,
      });
    });

    res.status(201).json(sanitizeUser(newUser));
  });

  app.put('/api/users/:id', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.isActive === false) {
      return res.status(403).json({ error: 'Akun Anda sedang nonaktif.' });
    }
    if (currentUser.role !== 'admin' && !currentUser.permissions?.canManageUsers) {
      return res.status(403).json({
        error: 'Akses ditolak: Hanya System Administrator yang memiliki hak mengelola akun pengguna.',
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
      permissions,
    } = req.body;

    const currentData = db.getData();
    const targetUser = currentData.users.find((u) => u.id === id);
    if (!targetUser) {
      return res.status(404).json({ error: 'Pengguna tidak ditemukan' });
    }

    const nextName = name !== undefined ? String(name).trim() : targetUser.name;
    const nextEmail =
      email !== undefined ? String(email).trim().toLowerCase() : targetUser.email.toLowerCase();
    const nextUsername =
      username !== undefined
        ? String(username)
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9._-]/g, '')
        : targetUser.username || deriveDefaultUsername(targetUser.email, targetUser.name);
    const nextRole = (role ?? targetUser.role) as User['role'];

    let nextAccountStatus: UserAccountStatus =
      targetUser.accountStatus || (targetUser.isActive === false ? 'Nonaktif' : 'Aktif');
    if (accountStatus && ['Aktif', 'Ditangguhkan', 'Nonaktif'].includes(accountStatus)) {
      nextAccountStatus = accountStatus as UserAccountStatus;
    } else if (isActive !== undefined) {
      nextAccountStatus = Boolean(isActive) ? 'Aktif' : 'Nonaktif';
    }
    const nextIsActive = nextAccountStatus === 'Aktif';

    if (!nextName || !nextEmail) {
      return res.status(400).json({ error: 'Nama dan email pengguna tidak boleh kosong.' });
    }

    if (!nextUsername || nextUsername.length < 3) {
      return res.status(400).json({ error: 'Username minimal terdiri dari 3 karakter.' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      return res.status(400).json({ error: 'Format alamat email tidak valid.' });
    }

    // Cegah duplikasi email, username, atau nama dengan pengguna lain
    const duplicateEmail = currentData.users.find(
      (u) => u.id !== id && u.email.trim().toLowerCase() === nextEmail
    );
    if (duplicateEmail) {
      return res.status(400).json({
        error: `Email "${nextEmail}" sudah digunakan oleh pengguna lain (${duplicateEmail.name}).`,
      });
    }

    const duplicateUsername = currentData.users.find(
      (u) =>
        u.id !== id &&
        (u.username || deriveDefaultUsername(u.email, u.name)).trim().toLowerCase() === nextUsername
    );
    if (duplicateUsername) {
      return res.status(400).json({
        error: `Username "${nextUsername}" sudah digunakan oleh akun ${duplicateUsername.name}.`,
      });
    }

    const duplicateName = currentData.users.find(
      (u) => u.id !== id && u.name.trim().toLowerCase() === nextName.toLowerCase()
    );
    if (duplicateName) {
      return res.status(400).json({
        error: `Nama "${nextName}" sudah digunakan oleh akun ${duplicateName.email}. Hindari duplikasi nama pengguna.`,
      });
    }

    // Cegah menonaktifkan/menangguhkan akun yang sedang dipakai sendiri atau Admin aktif terakhir
    if (!nextIsActive && id === currentUser.id) {
      return res.status(400).json({
        error: 'Tidak dapat menonaktifkan atau menangguhkan akun yang sedang Anda gunakan saat ini.',
      });
    }

    const activeAdmins = currentData.users.filter(
      (u) => u.isActive && (u.role === 'admin' || u.permissions?.canManageUsers)
    );
    const isTargetAdmin =
      targetUser.role === 'admin' || targetUser.permissions?.canManageUsers;
    const willRemainActiveAdmin =
      nextIsActive && (nextRole === 'admin' || permissions?.canManageUsers);

    if (isTargetAdmin && !willRemainActiveAdmin && activeAdmins.length <= 1) {
      return res.status(400).json({
        error: 'Sistem wajib memiliki minimal 1 akun Administrator aktif.',
      });
    }

    let updatedUser: User | null = null;

    db.update((d) => {
      const idx = d.users.findIndex((u) => u.id === id);
      if (idx !== -1) {
        const prevUser = d.users[idx];
        const previousName = prevUser.name;
        const prevStatus =
          prevUser.accountStatus || (prevUser.isActive === false ? 'Nonaktif' : 'Aktif');
        const resolvedPermissions = normalizeRolePermissions(
          nextRole,
          permissions !== undefined ? permissions : prevUser.permissions
        );

        d.users[idx] = {
          ...prevUser,
          username: nextUsername,
          name: nextName,
          email: nextEmail,
          role: nextRole,
          roleTitle:
            roleTitle !== undefined
              ? String(roleTitle).trim() || prevUser.roleTitle
              : prevUser.roleTitle,
          department:
            department !== undefined
              ? String(department).trim() || prevUser.department
              : prevUser.department,
          accountStatus: nextAccountStatus,
          isActive: nextIsActive,
          permissions: resolvedPermissions,
        };
        updatedUser = d.users[idx];

        // Sinkronkan identitas pengguna ke Monitoring Tools (RACI, Activity Monitoring, Laporan), Program, ToR, CA, dan Approval Hub
        cascadeSyncUserIdentityAcrossSystem(d, updatedUser, previousName);

        // Jika pengguna yang dinonaktifkan/ditangguhkan sedang memiliki sesi aktif, cabut sesi dan alihkan jika perlu
        if (!nextIsActive) {
          for (const [token, sess] of activeSessions.entries()) {
            if (sess.userId === id) {
              activeSessions.delete(token);
            }
          }
          if (d.currentUserId === id) {
            const fallback =
              d.users.find((u) => u.isActive && u.role === 'director') ||
              d.users.find((u) => u.isActive);
            if (fallback) {
              d.currentUserId = fallback.id;
            }
          }
        }

        const changesSummary: string[] = [];
        if (previousName !== updatedUser.name) {
          changesSummary.push(`Nama: "${previousName}" → "${updatedUser.name}"`);
        }
        if (prevUser.username !== updatedUser.username) {
          changesSummary.push(`Username: @${prevUser.username} → @${updatedUser.username}`);
        }
        if (prevUser.role !== updatedUser.role) {
          changesSummary.push(`Role: ${prevUser.role} → ${updatedUser.role}`);
        }
        if (prevStatus !== nextAccountStatus) {
          changesSummary.push(`Status Akun: ${prevStatus} → ${nextAccountStatus}`);
        }

        const auditActionLabel =
          prevStatus !== nextAccountStatus
            ? nextAccountStatus === 'Aktif'
              ? 'Aktivasi Akun Pengguna'
              : nextAccountStatus === 'Ditangguhkan'
              ? 'Penangguhan Akun Pengguna (Suspended)'
              : 'Penonaktifan Akun Pengguna'
            : 'Pembaruan Akun Pengguna';

        d.auditLogs.unshift({
          id: `log-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: auditActionLabel,
          entityType: 'USER',
          entityId: id,
          details: `Memperbarui akun ${updatedUser.name} (${updatedUser.roleTitle})${
            changesSummary.length > 0 ? ` — ${changesSummary.join(', ')}` : ''
          }`,
          timestamp: new Date().toISOString(),
        });
      }
    });

    if (!updatedUser) {
      return res.status(404).json({ error: 'Pengguna tidak ditemukan' });
    }

    res.json(sanitizeUser(updatedUser));
  });

  // Reset Password Pengguna oleh System Administrator
  app.post('/api/users/:id/reset-password', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.isActive === false) {
      return res.status(403).json({ error: 'Akun Anda sedang nonaktif.' });
    }
    if (currentUser.role !== 'admin' && !currentUser.permissions?.canManageUsers) {
      return res.status(403).json({
        error: 'Akses ditolak: Hanya System Administrator yang berwenang mereset password pengguna.',
      });
    }

    const { id } = req.params;
    const newPassword = String(req.body?.newPassword || '').trim();
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        error: 'Password baru minimal harus terdiri dari 6 karakter.',
      });
    }

    const currentData = db.getData();
    const targetUser = currentData.users.find((u) => u.id === id);
    if (!targetUser) {
      return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    }

    const nowIso = new Date().toISOString();
    const newHash = hashPassword(newPassword);
    let updatedUser: User = targetUser;

    db.update((d) => {
      const idx = d.users.findIndex((u) => u.id === id);
      if (idx !== -1) {
        d.users[idx].passwordHash = newHash;
        d.users[idx].passwordUpdatedAt = nowIso;
        d.users[idx].mustChangePassword =
          id === currentUser.id
            ? verifyPassword(DEFAULT_TESTING_PASSWORD, newHash)
            : true;
        updatedUser = d.users[idx];
      }
      d.auditLogs.unshift({
        id: `log-pwreset-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: 'Reset Password Pengguna',
        entityType: 'USER',
        entityId: id,
        details: `System Administrator mereset password untuk akun ${targetUser.name} (@${
          targetUser.username || deriveDefaultUsername(targetUser.email, targetUser.name)
        } · ${targetUser.roleTitle}).`,
        timestamp: nowIso,
      });
    });

    res.json({
      message: `Password untuk akun "${targetUser.name}" berhasil direset dan dienkripsi.`,
      user: sanitizeUser(updatedUser),
    });
  });

  app.delete('/api/users/:id', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.isActive === false) {
      return res.status(403).json({ error: 'Akun Anda sedang nonaktif.' });
    }
    if (currentUser.role !== 'admin' && !currentUser.permissions?.canManageUsers) {
      return res.status(403).json({ error: 'Hanya Admin yang memiliki hak menghapus akun pengguna' });
    }

    const { id } = req.params;
    if (id === currentUser.id) {
      return res.status(400).json({ error: 'Tidak dapat menghapus akun yang sedang Anda gunakan.' });
    }

    const currentData = db.getData();
    const targetUser = currentData.users.find((u) => u.id === id);
    if (!targetUser) {
      return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    }

    // Periksa keterkaitan data pada Monitoring Tools (RACI & Activity Monitoring), ToR, dan Cash Advance
    const raciRefs = Object.values(currentData.outputRaciRecords || {}).filter(
      (r) =>
        r.responsibleUserId === id ||
        r.accountableUserId === id ||
        r.accountableFinanceUserId === id ||
        (r.consultedUsers || []).includes(targetUser.name) ||
        (r.informedUsers || []).includes(targetUser.name)
    );
    const monitoringActRefs = Object.values(currentData.activityMonitoringRecords || {}).filter(
      (m) =>
        m.updatedById === id ||
        (m.tools || []).some((t) => t.assignedById === id)
    );
    const torRefs = (currentData.tors || []).filter(
      (t) => t.createdById === id || t.picId === id || t.picName === targetUser.name
    );
    const caRefs = (currentData.cashAdvances || []).filter((c) => c.requesterId === id);

    if (
      raciRefs.length > 0 ||
      monitoringActRefs.length > 0 ||
      torRefs.length > 0 ||
      caRefs.length > 0
    ) {
      return res.status(400).json({
        error: `Akun "${targetUser.name}" memiliki riwayat data aktif/historis (${raciRefs.length} RACI Output, ${monitoringActRefs.length} Monitoring Activity, ${torRefs.length} ToR, ${caRefs.length} Cash Advance). Demi menjaga keutuhan riwayat monitoring dan audit trail, gunakan fitur "Nonaktifkan" (jangan dihapus permanen).`,
      });
    }

    db.update((d) => {
      d.users = d.users.filter((u) => u.id !== id);
      d.auditLogs.unshift({
        id: `log-del-user-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: 'Penghapusan Akun Pengguna',
        entityType: 'USER',
        entityId: id,
        details: `Menghapus akun pengguna yang belum memiliki riwayat penugasan: ${targetUser.name} (${targetUser.email})`,
        timestamp: new Date().toISOString(),
      });
    });

    res.json({
      message: `Akun pengguna ${targetUser.name} berhasil dihapus.`,
      id,
    });
  });

  // --- PROGRAM STRUCTURE APIS (Program -> Outcome -> Output -> Activity -> Sub-Activity) ---

  app.get('/api/programs', (req: Request, res: Response) => {
    const data = db.getData();
    res.json({
      programs: data.programs || [],
      outcomes: data.outcomes,
      outputs: data.outputs,
      activities: data.activities,
      subActivities: data.subActivities,
    });
  });

  // Programs CRUD
  app.post('/api/programs', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (!currentUser.permissions.canManagePrograms && currentUser.role !== 'director' && currentUser.role !== 'program_manager') {
      return res.status(403).json({ error: 'Tidak memiliki kewenangan membuat Program baru' });
    }

    const { name, location, startDate, endDate, description, folderUrl, picId, status } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Nama Program / Judul Program wajib diisi' });
    }
    if (!location || !location.trim()) {
      return res.status(400).json({ error: 'Lokasi Program wajib diisi' });
    }
    if (!startDate) {
      return res.status(400).json({ error: 'Tanggal Mulai program wajib diisi' });
    }
    if (!endDate) {
      return res.status(400).json({ error: 'Tanggal Selesai program wajib diisi' });
    }
    if (new Date(endDate) < new Date(startDate)) {
      return res.status(400).json({ error: 'Tanggal selesai tidak boleh lebih awal dari tanggal mulai' });
    }

    const data = db.getData();
    const picUser = picId ? data.users.find((u) => u.id === picId) : currentUser;

    const newProgram: Program = {
      id: `prog-${Date.now()}`,
      name: name.trim(),
      location: location.trim(),
      startDate,
      endDate,
      description: description ? description.trim() : '',
      folderUrl: folderUrl ? String(folderUrl).trim() : '',
      picId: picUser ? picUser.id : currentUser.id,
      picName: picUser ? picUser.name : currentUser.name,
      status: (status as ProgramStatus) || 'Aktif',
      createdAt: new Date().toISOString(),
    };

    db.update((d) => {
      if (!d.programs) d.programs = [];
      d.programs.unshift(newProgram);
      d.auditLogs.unshift({
        id: `log-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: 'Pembuatan Program',
        entityType: 'PROGRAM',
        entityId: newProgram.id,
        details: `Membuat Program baru: ${newProgram.name} di ${newProgram.location}`,
        timestamp: new Date().toISOString(),
      });
    });

    res.status(201).json(newProgram);
  });

  app.put('/api/programs/:id', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (!currentUser.permissions.canManagePrograms && currentUser.role !== 'director' && currentUser.role !== 'program_manager') {
      return res.status(403).json({ error: 'Tidak memiliki kewenangan mengubah Program' });
    }

    const { id } = req.params;
    const { name, location, startDate, endDate, description, folderUrl, picId, status } = req.body;

    if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
      return res.status(400).json({ error: 'Tanggal selesai tidak boleh lebih awal dari tanggal mulai' });
    }

    const data = db.getData();
    const picUser = picId ? data.users.find((u) => u.id === picId) : null;

    let updated: Program | null = null;
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
          description: description !== undefined ? description.trim() : d.programs[idx].description,
          folderUrl: folderUrl !== undefined ? String(folderUrl).trim() : d.programs[idx].folderUrl,
          picId: picUser ? picUser.id : d.programs[idx].picId,
          picName: picUser ? picUser.name : d.programs[idx].picName,
          status: status ?? d.programs[idx].status,
          updatedAt: new Date().toISOString(),
        };
        updated = d.programs[idx];

        // Keep programName in associated outcomes & tors synced
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
          action: 'Pembaruan Program',
          entityType: 'PROGRAM',
          entityId: id,
          details: `Memperbarui informasi Program: ${updated.name}`,
          timestamp: new Date().toISOString(),
        });
      }
    });

    if (!updated) return res.status(404).json({ error: 'Program tidak ditemukan' });
    res.json(updated);
  });

  app.delete('/api/programs/:id', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (
      !currentUser.permissions.canManagePrograms &&
      currentUser.role !== 'director' &&
      currentUser.role !== 'program_manager' &&
      currentUser.role !== 'finance' &&
      currentUser.role !== 'hr' &&
      currentUser.role !== 'admin'
    ) {
      return res.status(403).json({ error: 'Tidak memiliki kewenangan menghapus Program' });
    }

    const { id } = req.params;
    const data = db.getData();
    const targetProgram = (data.programs || []).find((p) => p.id === id);
    if (!targetProgram) {
      return res.status(404).json({ error: 'Program tidak ditemukan' });
    }

    if (targetProgram.status !== 'Selesai') {
      return res.status(400).json({
        error: 'Hanya Program yang sudah berstatus Selesai yang dapat dihapus.',
      });
    }

    let deletedName = '';
    db.update((d) => {
      if (!d.programs) d.programs = [];
      const idx = d.programs.findIndex((p) => p.id === id);
      if (idx !== -1) {
        deletedName = d.programs[idx].name;
        d.programs.splice(idx, 1);

        // Cascade delete child Outcomes, Outputs, Activities, and SubActivities for this completed program
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
          action: 'Penghapusan Program',
          entityType: 'PROGRAM',
          entityId: id,
          details: `Menghapus Program Selesai: ${deletedName}`,
          timestamp: new Date().toISOString(),
        });
      }
    });

    res.json({ message: 'Program berhasil dihapus' });
  });

  // Outcomes
  app.post('/api/outcomes', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (
      currentUser.role !== 'director' &&
      currentUser.role !== 'program_manager' &&
      currentUser.role !== 'finance' &&
      currentUser.role !== 'meal' &&
      !currentUser.permissions?.canManagePrograms
    ) {
      return res.status(403).json({ error: 'Tidak memiliki kewenangan membuat Outcome' });
    }

    const { programId, outcomeNumber, name, description, picId, indicators, status } = req.body;
    const cleanNumber = String(outcomeNumber || '').trim();
    const cleanDesc = String(description || '').trim();
    const cleanName =
      String(name || '').trim() ||
      (cleanNumber && cleanDesc
        ? `${cleanNumber}: ${cleanDesc}`
        : cleanDesc || cleanNumber);

    if (!cleanName) {
      return res.status(400).json({ error: 'Nomor Outcome atau Description Outcome wajib diisi' });
    }
    if (!programId) {
      return res.status(400).json({ error: 'Program induk wajib dipilih' });
    }

    const data = db.getData();
    const program = (data.programs || []).find((p) => p.id === programId);
    if (!program) {
      return res.status(400).json({ error: 'Program induk yang dipilih tidak ditemukan' });
    }

    const picUser = data.users.find((u) => u.id === picId) || currentUser;

    const newOutcome: Outcome = {
      id: `out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      programId: program.id,
      programName: program.name,
      outcomeNumber: cleanNumber || undefined,
      name: cleanName,
      description: cleanDesc || cleanName,
      picId: picUser.id,
      picName: picUser.name,
      projectName: program.name,
      status: status || 'Belum Dimulai',
      indicators: Array.isArray(indicators) ? indicators : [],
      createdAt: new Date().toISOString(),
    };

    db.update((d) => {
      d.outcomes.push(newOutcome);
      d.auditLogs.unshift({
        id: `log-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: 'Pembuatan Outcome',
        entityType: 'PROGRAM',
        entityId: newOutcome.id,
        details: `Membuat Outcome baru: ${newOutcome.name} di bawah Program: ${program.name}`,
        timestamp: new Date().toISOString(),
      });
    });

    res.status(201).json(newOutcome);
  });

  app.put('/api/outcomes/:id', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (
      currentUser.role !== 'director' &&
      currentUser.role !== 'program_manager' &&
      currentUser.role !== 'finance' &&
      currentUser.role !== 'meal' &&
      !currentUser.permissions?.canManagePrograms
    ) {
      return res.status(403).json({ error: 'Tidak memiliki kewenangan mengubah Outcome' });
    }

    const { id } = req.params;
    const { outcomeNumber, name, description, picId, projectName, indicators, status } = req.body;
    const data = db.getData();
    const picUser = picId ? data.users.find((u) => u.id === picId) : null;

    let updated: Outcome | null = null;
    db.update((d) => {
      const idx = d.outcomes.findIndex((o) => o.id === id);
      if (idx !== -1) {
        const nextNum =
          outcomeNumber !== undefined
            ? String(outcomeNumber).trim()
            : d.outcomes[idx].outcomeNumber;
        const nextDesc =
          description !== undefined
            ? String(description).trim()
            : d.outcomes[idx].description;
        const nextName =
          name !== undefined && String(name).trim()
            ? String(name).trim()
            : nextNum && nextDesc
            ? `${nextNum}: ${nextDesc}`
            : d.outcomes[idx].name;

        d.outcomes[idx] = {
          ...d.outcomes[idx],
          outcomeNumber: nextNum || undefined,
          name: nextName,
          description: nextDesc ?? d.outcomes[idx].description,
          picId: picUser ? picUser.id : d.outcomes[idx].picId,
          picName: picUser ? picUser.name : d.outcomes[idx].picName,
          projectName: projectName ?? d.outcomes[idx].projectName,
          indicators: indicators ?? d.outcomes[idx].indicators,
          status: status ?? d.outcomes[idx].status,
        };
        updated = d.outcomes[idx];
      }
    });

    if (!updated) return res.status(404).json({ error: 'Outcome tidak ditemukan' });
    res.json(updated);
  });

  app.delete('/api/outcomes/:id', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (
      currentUser.role !== 'director' &&
      currentUser.role !== 'program_manager' &&
      currentUser.role !== 'finance' &&
      currentUser.role !== 'meal' &&
      !currentUser.permissions?.canManagePrograms
    ) {
      return res.status(403).json({ error: 'Tidak memiliki kewenangan menghapus Outcome' });
    }

    const { id } = req.params;
    const data = db.getData();
    const hasOutputs = data.outputs.some((o) => o.outcomeId === id);
    if (hasOutputs) {
      return res.status(400).json({
        error: 'Tidak dapat menghapus Outcome ini karena masih memiliki Output terhubung. Hapus atau pindahkan Output terlebih dahulu.',
      });
    }

    db.update((d) => {
      d.outcomes = d.outcomes.filter((o) => o.id !== id);
      d.auditLogs.unshift({
        id: `log-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: 'Penghapusan Outcome',
        entityType: 'PROGRAM',
        entityId: id,
        details: `Menghapus Outcome ID: ${id}`,
        timestamp: new Date().toISOString(),
      });
    });

    res.json({ message: 'Outcome berhasil dihapus' });
  });

  // Outputs
  app.post('/api/outputs', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (
      currentUser.role !== 'director' &&
      currentUser.role !== 'program_manager' &&
      currentUser.role !== 'finance' &&
      currentUser.role !== 'meal' &&
      !currentUser.permissions?.canManagePrograms
    ) {
      return res.status(403).json({ error: 'Tidak memiliki kewenangan membuat Output' });
    }

    const { outcomeId, outputNumber, name, description, picId, indicators, status } = req.body;
    const cleanNumber = String(outputNumber || '').trim();
    const cleanDesc = String(description || '').trim();
    const cleanName =
      String(name || '').trim() ||
      (cleanNumber && cleanDesc
        ? `${cleanNumber}: ${cleanDesc}`
        : cleanDesc || cleanNumber);

    if (!outcomeId || !cleanName) {
      return res.status(400).json({ error: 'Outcome dan Nomor/Deskripsi Output wajib diisi' });
    }

    const data = db.getData();
    const outcomeExists = data.outcomes.some((o) => o.id === outcomeId);
    if (!outcomeExists) {
      return res.status(400).json({ error: 'Outcome yang dipilih tidak valid' });
    }

    const picUser = data.users.find((u) => u.id === picId) || currentUser;

    const newOutput: Output = {
      id: `outp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      outcomeId,
      outputNumber: cleanNumber || undefined,
      name: cleanName,
      description: cleanDesc || cleanName,
      picId: picUser.id,
      picName: picUser.name,
      status: status || 'Belum Dimulai',
      indicators: Array.isArray(indicators) ? indicators : [],
      createdAt: new Date().toISOString(),
    };

    db.update((d) => {
      d.outputs.push(newOutput);
    });

    res.status(201).json(newOutput);
  });

  app.put('/api/outputs/:id', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (
      currentUser.role !== 'director' &&
      currentUser.role !== 'program_manager' &&
      currentUser.role !== 'finance' &&
      currentUser.role !== 'meal' &&
      !currentUser.permissions?.canManagePrograms
    ) {
      return res.status(403).json({ error: 'Tidak memiliki kewenangan mengubah Output' });
    }

    const { id } = req.params;
    const { outputNumber, name, description, picId, indicators, status, outcomeId } = req.body;
    const data = db.getData();
    const picUser = picId ? data.users.find((u) => u.id === picId) : null;

    let updated: Output | null = null;
    db.update((d) => {
      const idx = d.outputs.findIndex((o) => o.id === id);
      if (idx !== -1) {
        const nextNum =
          outputNumber !== undefined
            ? String(outputNumber).trim()
            : d.outputs[idx].outputNumber;
        const nextDesc =
          description !== undefined
            ? String(description).trim()
            : d.outputs[idx].description;
        const nextName =
          name !== undefined && String(name).trim()
            ? String(name).trim()
            : nextNum && nextDesc
            ? `${nextNum}: ${nextDesc}`
            : d.outputs[idx].name;

        d.outputs[idx] = {
          ...d.outputs[idx],
          outcomeId: outcomeId ?? d.outputs[idx].outcomeId,
          outputNumber: nextNum || undefined,
          name: nextName,
          description: nextDesc ?? d.outputs[idx].description,
          picId: picUser ? picUser.id : d.outputs[idx].picId,
          picName: picUser ? picUser.name : d.outputs[idx].picName,
          indicators: indicators ?? d.outputs[idx].indicators,
          status: status ?? d.outputs[idx].status,
        };
        updated = d.outputs[idx];
      }
    });

    if (!updated) return res.status(404).json({ error: 'Output tidak ditemukan' });
    res.json(updated);
  });

  app.delete('/api/outputs/:id', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (
      currentUser.role !== 'director' &&
      currentUser.role !== 'program_manager' &&
      currentUser.role !== 'finance' &&
      currentUser.role !== 'meal' &&
      !currentUser.permissions?.canManagePrograms
    ) {
      return res.status(403).json({ error: 'Tidak memiliki kewenangan menghapus Output' });
    }

    const { id } = req.params;
    const data = db.getData();
    const hasActivities = data.activities.some((a) => a.outputId === id);
    if (hasActivities) {
      return res.status(400).json({
        error: 'Tidak dapat menghapus Output ini karena masih memiliki Activity terhubung.',
      });
    }

    db.update((d) => {
      d.outputs = d.outputs.filter((o) => o.id !== id);
    });

    res.json({ message: 'Output berhasil dihapus' });
  });

  // Activities
  app.post('/api/activities', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (
      currentUser.role !== 'director' &&
      currentUser.role !== 'program_manager' &&
      currentUser.role !== 'finance' &&
      currentUser.role !== 'meal' &&
      !currentUser.permissions?.canManagePrograms
    ) {
      return res.status(403).json({ error: 'Tidak memiliki kewenangan membuat Activity' });
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
      status,
    } = req.body;
    if (!outputId || !name) {
      return res.status(400).json({ error: 'Output dan Nama Activity wajib diisi' });
    }

    const data = db.getData();
    const outputExists = data.outputs.some((o) => o.id === outputId);
    if (!outputExists) {
      return res.status(400).json({ error: 'Output yang dipilih tidak valid' });
    }

    const picUser = data.users.find((u) => u.id === picId) || currentUser;

    const newActivity: Activity = {
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      outputId,
      activityNumber:
        typeof activityNumber === 'string' && activityNumber.trim()
          ? activityNumber.trim()
          : undefined,
      name,
      code: typeof code === 'string' && code.trim() ? code.trim() : undefined,
      description: description || '',
      anticipatedInputs:
        typeof anticipatedInputs === 'string' ? anticipatedInputs.trim() : undefined,
      plannedParticipantsBreakdown:
        typeof plannedParticipantsBreakdown === 'string'
          ? plannedParticipantsBreakdown.trim()
          : undefined,
      picId: picUser.id,
      picName: picUser.name,
      startDate: startDate || new Date().toISOString().slice(0, 10),
      endDate: endDate || new Date().toISOString().slice(0, 10),
      status: status || 'Belum Dimulai',
      createdAt: new Date().toISOString(),
    };

    db.update((d) => {
      d.activities.push(newActivity);
    });

    res.status(201).json(newActivity);
  });

  app.put('/api/activities/:id', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (
      currentUser.role !== 'director' &&
      currentUser.role !== 'program_manager' &&
      currentUser.role !== 'finance' &&
      currentUser.role !== 'meal' &&
      !currentUser.permissions?.canManagePrograms
    ) {
      return res.status(403).json({ error: 'Tidak memiliki kewenangan mengubah Activity' });
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
      outputId,
    } = req.body;
    const data = db.getData();
    const picUser = picId ? data.users.find((u) => u.id === picId) : null;

    let updated: Activity | null = null;
    db.update((d) => {
      const idx = d.activities.findIndex((a) => a.id === id);
      if (idx !== -1) {
        const nextCode =
          code !== undefined
            ? typeof code === 'string' && code.trim()
              ? code.trim()
              : undefined
            : d.activities[idx].code;
        d.activities[idx] = {
          ...d.activities[idx],
          outputId: outputId ?? d.activities[idx].outputId,
          activityNumber:
            activityNumber !== undefined
              ? typeof activityNumber === 'string' && activityNumber.trim()
                ? activityNumber.trim()
                : undefined
              : d.activities[idx].activityNumber,
          name: name ?? d.activities[idx].name,
          code: nextCode,
          description: description ?? d.activities[idx].description,
          anticipatedInputs:
            anticipatedInputs !== undefined
              ? typeof anticipatedInputs === 'string'
                ? anticipatedInputs.trim()
                : ''
              : d.activities[idx].anticipatedInputs,
          plannedParticipantsBreakdown:
            plannedParticipantsBreakdown !== undefined
              ? typeof plannedParticipantsBreakdown === 'string'
                ? plannedParticipantsBreakdown.trim()
                : ''
              : d.activities[idx].plannedParticipantsBreakdown,
          picId: picUser ? picUser.id : d.activities[idx].picId,
          picName: picUser ? picUser.name : d.activities[idx].picName,
          startDate: startDate ?? d.activities[idx].startDate,
          endDate: endDate ?? d.activities[idx].endDate,
          status: status ?? d.activities[idx].status,
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

    if (!updated) return res.status(404).json({ error: 'Activity tidak ditemukan' });
    res.json(updated);
  });

  app.delete('/api/activities/:id', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (
      currentUser.role !== 'director' &&
      currentUser.role !== 'program_manager' &&
      currentUser.role !== 'finance' &&
      currentUser.role !== 'meal' &&
      !currentUser.permissions?.canManagePrograms
    ) {
      return res.status(403).json({ error: 'Tidak memiliki kewenangan menghapus Activity' });
    }

    const { id } = req.params;
    const data = db.getData();
    const hasTors = data.tors.some((t) => t.activityId === id);
    if (hasTors) {
      return res.status(400).json({
        error: 'Tidak dapat menghapus Activity ini karena masih memiliki TOR terhubung.',
      });
    }

    db.update((d) => {
      d.activities = d.activities.filter((a) => a.id !== id);
      d.subActivities = d.subActivities.filter((s) => s.activityId !== id);
    });

    res.json({ message: 'Activity berhasil dihapus' });
  });

  // Sub-Activities (optional)
  app.post('/api/sub-activities', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (
      currentUser.role !== 'director' &&
      currentUser.role !== 'program_manager' &&
      currentUser.role !== 'finance' &&
      currentUser.role !== 'meal' &&
      !currentUser.permissions?.canManagePrograms
    ) {
      return res.status(403).json({ error: 'Tidak memiliki kewenangan membuat Sub-Activity' });
    }

    const { activityId, name, description, picName, startDate, endDate, status } = req.body;
    if (!activityId || !name) {
      return res.status(400).json({ error: 'Activity ID dan Nama Sub-Activity wajib diisi' });
    }

    const newSub: SubActivity = {
      id: `sub-${Date.now()}`,
      activityId,
      name,
      description: description || '',
      picName: picName || '',
      startDate: startDate || '',
      endDate: endDate || '',
      status: status || 'Belum Dimulai',
      createdAt: new Date().toISOString(),
    };

    db.update((d) => {
      d.subActivities.push(newSub);
    });

    res.status(201).json(newSub);
  });

  app.delete('/api/sub-activities/:id', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (
      currentUser.role !== 'director' &&
      currentUser.role !== 'program_manager' &&
      !currentUser.permissions?.canManagePrograms
    ) {
      return res.status(403).json({ error: 'Tidak memiliki kewenangan menghapus Sub-Activity' });
    }
    const { id } = req.params;
    db.update((d) => {
      d.subActivities = d.subActivities.filter((s) => s.id !== id);
    });
    res.json({ message: 'Sub-Activity berhasil dihapus' });
  });

  // --- TOR APIS ---

  app.get('/api/tors', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const data = db.getData();
    let tors = data.tors.map((t) => ({
      ...t,
      budgetRequested: getConnectedBudgetRequested(t, data.cashAdvances),
    }));

    // Role-based visibility:
    // Director, PM, MEAL, Finance, Admin see all TORs.
    // User Biasa / Staff only sees TORs where they are PIC or creator.
    if (currentUser.role === 'staff' && !currentUser.permissions.canViewAllTors) {
      tors = tors.filter((t) => t.picId === currentUser.id || t.createdById === currentUser.id);
    }

    // Filters:
    const { search, picId, status, activityStatus } = req.query;
    if (search && typeof search === 'string') {
      const q = search.toLowerCase();
      tors = tors.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.torNumber.toLowerCase().includes(q) ||
          t.activityName.toLowerCase().includes(q) ||
          t.picName.toLowerCase().includes(q)
      );
    }
    if (picId && typeof picId === 'string') {
      tors = tors.filter((t) => t.picId === picId);
    }
    if (status && typeof status === 'string') {
      tors = tors.filter((t) => t.submissionStatus === status);
    }
    if (activityStatus && typeof activityStatus === 'string') {
      tors = tors.filter((t) => t.activityStatus === activityStatus);
    }

    // Sort order per requirements:
    // 1. TOR yang sedang berjalan
    // 2. TOR yang berjalan dan masih memiliki kewajiban pelaporan
    // 3. TOR yang menunggu persetujuan
    // 4. TOR yang belum dimulai
    // 5. TOR yang selesai dan seluruh kewajiban terpenuhi
    tors.sort((a, b) => {
      const score = (t: Tor) => {
        if (t.activityStatus === 'Sedang Berjalan') return 1;
        if (t.submissionStatus.includes('Menunggu Persetujuan')) return 2;
        if (t.activityStatus === 'Belum Dimulai') return 3;
        if (t.activityStatus === 'Selesai') return 4;
        return 5;
      };
      return score(a) - score(b);
    });

    res.json(tors);
  });

  // Preview TOR Number (Live Draft & Validation)
  app.get('/api/tors/preview-number', (req: Request, res: Response) => {
    const { programId, outcomeId, outputId, activityId, date } = req.query as {
      programId?: string;
      outcomeId?: string;
      outputId?: string;
      activityId?: string;
      date?: string;
    };
    const data = db.getData();
    const program = programId ? (data.programs || []).find((p) => p.id === programId) : null;
    const programName = program?.name || '';

    const d = date ? new Date(date) : new Date();
    const validDate = isNaN(d.getTime()) ? new Date() : d;
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
      date: validDate,
    });

    res.json({
      ...preview,
      nextSequenceNumber: nextSeq,
    });
  });

  app.get('/api/tors/:id', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const data = db.getData();
    const foundTor = data.tors.find((t) => t.id === id);
    if (!foundTor) {
      return res.status(404).json({ error: 'TOR tidak ditemukan' });
    }
    if (!canUserAccessTorRecord(currentUser, foundTor, data)) {
      return res.status(403).json({
        error: 'Akses ditolak: Anda tidak memiliki hak akses untuk melihat dokumen TOR ini.',
      });
    }

    const tor = {
      ...foundTor,
      budgetRequested: getConnectedBudgetRequested(foundTor, data.cashAdvances),
    };
    const records = data.approvalRecords.filter((r) => r.torId === id);
    res.json({ tor, approvalRecords: records });
  });

  // Create TOR
  app.post('/api/tors', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (!currentUser.permissions.canCreateTor && currentUser.role === 'admin') {
      return res.status(403).json({ error: 'Admin tidak berwenang membuat TOR' });
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
      submitImmediately,
    } = req.body;

    if (!title || !outcomeId || !outputId || !activityId || !picId) {
      return res.status(400).json({ error: 'Judul, Outcome, Output, Activity, dan PIC wajib diisi' });
    }

    const data = db.getData();
    const outcome = data.outcomes.find((o) => o.id === outcomeId);
    const output = data.outputs.find((o) => o.id === outputId);
    const activity = data.activities.find((a) => a.id === activityId);
    const picUser = data.users.find((u) => u.id === picId);

    if (!outcome || !output || !activity || !picUser) {
      return res.status(400).json({ error: 'Relasi Program atau PIC tidak valid' });
    }

    // Enforce Output-level RACI Access Control (R, A1, A2 with Active Director-Approved RACI)
    const outputRaci = data.outputRaciRecords?.[outputId];
    if (!outputRaci || outputRaci.status !== 'Aktif') {
      return res.status(403).json({
        error:
          outputRaci?.status === 'Menunggu Persetujuan Direktur'
            ? `Penugasan RACI pada Output "${output.name}" masih menunggu persetujuan Direktur. Pembuatan ToR belum diizinkan.`
            : `Penugasan RACI pada Output "${output.name}" belum ditentukan dan disetujui Direktur.`,
      });
    }

    const isR = outputRaci.responsibleUserId === currentUser.id;
    const isA1 = outputRaci.accountableUserId === currentUser.id;
    const isA2 =
      currentUser.role === 'finance' ||
      (currentUser.roleTitle || '').toLowerCase().includes('finance');

    if (!isR && !isA1 && !isA2) {
      return res.status(403).json({
        error: `Anda tidak memiliki penugasan R (Responsible), A1 (Accountable Program), atau A2 (Accountable Finance) pada Output "${output.name}".`,
      });
    }

    const creatorRaciRoleLabel = isR
      ? 'R – Responsible'
      : isA1
      ? 'A1 – Accountable Program'
      : 'A2 – Accountable Finance';

    const program = outcome.programId
      ? (data.programs || []).find((p) => p.id === outcome.programId)
      : null;
    const programId = req.body.programId || program?.id || outcome.programId || '';
    const programName = program?.name || outcome.programName || outcome.projectName || '';
    const programCode = generateProgramCode(programName, program?.code);

    const { hierarchyCode, isComplete: isHierarchyComplete } = computeHierarchyCode({
      programId,
      outcomeId,
      outputId,
      activityId,
      outcomes: data.outcomes,
      outputs: data.outputs,
      activities: data.activities,
    });

    // Rule: Jika Program atau Outcome/Output/Activity belum dipilih, tampilkan status bahwa nomor TOR belum lengkap dan jangan menerbitkan nomor resmi.
    if (submitImmediately && (!programName || !isHierarchyComplete)) {
      return res.status(400).json({
        error: 'Program, Outcome, Output, dan Activity wajib ditentukan sebelum menerbitkan nomor TOR resmi.',
      });
    }

    // Determine initial status (Tahap 1 R -> Tahap 2 A1 Accountable Program):
    let initialStatus: SubmissionStatus = 'Draft';
    if (submitImmediately) {
      initialStatus = 'Menunggu Persetujuan Finance';
    }

    // Automatic TOR Number Generator WIJNA
    // Format: TOR/[Nomor Urut]/WIJNA/[Kode Program]/[Kode Outcome].[Kode Output].[Nomor Activity]/[Bulan Romawi]/[Tahun]
    // Contoh: TOR/001/WIJNA/PET/1.2.3/X/2026
    let torNumber: string;
    let isOfficialNumber = false;
    let publishedAt: string | undefined = undefined;
    let torSequence: number | undefined = undefined;

    if (submitImmediately) {
      const now = new Date();
      const year = now.getFullYear();
      const nextSeq = getNextTorSequenceForYear(data, year);
      const romanMonth = getRomanMonth(now);

      torNumber = formatTorNumber({
        sequence: nextSeq,
        programCode,
        hierarchyCode,
        romanMonth,
        year,
      });
      isOfficialNumber = true;
      publishedAt = now.toISOString();
      torSequence = nextSeq;
    } else {
      // Draft belum memiliki nomor resmi permanen
      const romanMonth = getRomanMonth(new Date());
      const year = new Date().getFullYear();
      if (programCode && isHierarchyComplete) {
        torNumber = `DRAFT/WIJNA/${programCode}/${hierarchyCode}/${romanMonth}/${year}`;
      } else {
        torNumber = `DRAFT/WIJNA/BELUM-LENGKAP`;
      }
    }

    const newTor: Tor = {
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
      background: background || '',
      rationale: rationale || '',
      generalObjective: generalObjective || '',
      objectives: objectives || '',
      participantType: participantType || participantsType || '',
      participantsType: participantType || participantsType || '',
      participantsTarget: participantsTarget || '',
      participantsCount: participantsCount !== undefined && participantsCount !== null && participantsCount !== '' ? Number(participantsCount) : null,
      participantsCriteria: participantsCriteria || '',
      participantTableMode: participantTableMode || 'simple',
      participantRows: Array.isArray(participantRows) ? participantRows : [],
      participantCustomColumns: Array.isArray(participantCustomColumns) ? participantCustomColumns : [],
      goals: goals || [],
      indicators: indicators || [],
      rolesResponsibilities: rolesResponsibilities || [],
      rolesNotes: rolesNotes || rolesAdditionalNotes || '',
      rolesAdditionalNotes: rolesNotes || rolesAdditionalNotes || '',
      mealItems: mealItems || [],
      rundown: rundown || [],
      rundownNotes: rundownNotes || rundownAdditionalNotes || '',
      rundownAdditionalNotes: rundownNotes || rundownAdditionalNotes || '',
      challengesMitigations: challengesMitigations || [],
      challengesNotes: challengesNotes || challengesAdditionalNotes || '',
      challengesAdditionalNotes: challengesNotes || challengesAdditionalNotes || '',
      activityDescription: activityDescription || '',
      expectedResults: expectedResults || '',
      location: location || '',
      locations: req.body.locations || [],
      customPeriodId: req.body.customPeriodId || undefined,
      customPeriodCode: req.body.customPeriodCode || undefined,
      customPeriodLabel: req.body.customPeriodLabel || undefined,
      customPeriodStartDate: req.body.customPeriodStartDate || undefined,
      customPeriodEndDate: req.body.customPeriodEndDate || undefined,
      customPeriodAllocatedAmount:
        req.body.customPeriodAllocatedAmount !== undefined
          ? Number(req.body.customPeriodAllocatedAmount)
          : undefined,
      startDate: startDate || new Date().toISOString().slice(0, 10),
      endDate: endDate || new Date().toISOString().slice(0, 10),
      reportingPeriodType: reportingPeriodType || 'Sekali / Akhir Kegiatan',
      reportingFrequency: reportingFrequency || '1 kali di akhir kegiatan',
      reportingDeadline: reportingDeadline || endDate || new Date().toISOString().slice(0, 10),
      additionalNotes: additionalNotes || '',
      specificObjectives: req.body.specificObjectives || [],
      timelineItems: req.body.timelineItems || [],
      monitoringItems: req.body.monitoringItems || [],
      scopeOfActivities: req.body.scopeOfActivities || [],
      implementationMechanisms: req.body.implementationMechanisms || [],
      isRundownVisible: req.body.isRundownVisible !== undefined ? req.body.isRundownVisible : false,
      organizerPersonInCharge: req.body.organizerPersonInCharge || undefined,
      activityStatus: 'Belum Dimulai',
      submissionStatus: initialStatus,
      budgetRequested: req.body.budgetRequested !== undefined ? Number(req.body.budgetRequested) : null,
      budgetApproved: req.body.budgetApproved !== undefined ? Number(req.body.budgetApproved) : null,
      budgetActualSpent: req.body.budgetActualSpent !== undefined ? Number(req.body.budgetActualSpent) : null,
      budgetCurrency: req.body.budgetCurrency || 'IDR',
      budgetNotes: req.body.budgetNotes || '',
      budgetApprovalStatus: req.body.budgetApprovalStatus || 'Menunggu ACC Direktur',
      budgetDeterminedByFinanceName:
        req.body.budgetDeterminedByFinanceName || 'Ratna Kusuma, S.E.',
      budgetDeterminedByFinanceAt:
        req.body.budgetDeterminedByFinanceAt || new Date().toISOString(),
      budgetUpdatedByA2Name: req.body.budgetUpdatedByA2Name || undefined,
      budgetUpdatedByA2At: req.body.budgetUpdatedByA2At || undefined,
      budgetApprovedByDirectorName: req.body.budgetApprovedByDirectorName || undefined,
      budgetApprovedByDirectorAt: req.body.budgetApprovedByDirectorAt || undefined,
      budgetAuditLogs: Array.isArray(req.body.budgetAuditLogs)
        ? req.body.budgetAuditLogs
        : [
            {
              id: `bgt-log-${Date.now()}`,
              timestamp: new Date().toISOString(),
              actorName: req.body.budgetDeterminedByFinanceName || 'Ratna Kusuma, S.E.',
              actorRole: 'Finance / A2',
              actionLabel: 'Penentuan Estimasi Budget Awal ToR oleh Finance',
              amount: req.body.budgetRequested !== undefined ? Number(req.body.budgetRequested) : 0,
              status: req.body.budgetApprovalStatus || 'Menunggu ACC Direktur',
            },
          ],
      createdById: currentUser.id,
      createdByName: currentUser.name,
      createdByRole: currentUser.role,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.update((d) => {
      d.tors.push(newTor);
      syncApprovalHubData(d);

      if (submitImmediately) {
        const nowIso = new Date().toISOString();
        d.approvalRecords.push({
          id: `app-${Date.now()}`,
          torId: newTor.id,
          stage: 'Pengajuan',
          action: 'Diajukan',
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.role,
          comment: 'TOR diajukan kepada A1 (Accountable Program) untuk pemeriksaan.',
          timestamp: nowIso,
          resultingStatus: initialStatus,
        });

        const hubItem = d.approvalHubItems?.[`apv-tor-${newTor.id}`];
        if (hubItem) {
          hubItem.timeline = hubItem.timeline || [];
          hubItem.timeline.unshift({
            id: `tl-tor-sub-${newTor.id}-${Date.now()}`,
            timestamp: nowIso,
            actorId: currentUser.id,
            actorName: currentUser.name,
            actorRoleCode: 'R',
            actorRoleTitle: currentUser.roleTitle || 'PIC Kegiatan',
            responsibleName: newTor.picName,
            actionLabel: 'Mengajukan Dokumen ToR ke A1 (Accountable Program)',
            resultingStatus: 'Pending Verification',
            comment: 'TOR diajukan kepada A1 (Accountable Program) untuk pemeriksaan.',
            version: 1,
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
            categoryCode: 'tor',
            categoryLabel: 'Terms of Reference (ToR)',
            eventType: 'NEW_SUBMISSION',
            message: `[Terms of Reference (ToR)] "${newTor.title}" (${newTor.torNumber}) telah diajukan oleh ${currentUser.name} dan menunggu pemeriksaan A1 (${hubItem.accountableProgramUserName}).`,
            targetUserIds: [hubItem.accountableProgramUserId].filter(Boolean),
            targetRoleCodes: ['A1'],
            createdAt: nowIso,
            isReadByUserIds: [],
          });
        }
      }

      d.auditLogs.unshift({
        id: `log-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: submitImmediately ? 'Pembuatan & Pengajuan TOR' : 'Penyimpanan Draft TOR',
        entityType: 'TOR',
        entityId: newTor.id,
        details: `${newTor.torNumber}: ${newTor.title} (${initialStatus}) — Dibuat oleh ${currentUser.name} [${creatorRaciRoleLabel}] pada Output "${output.name}".`,
        timestamp: new Date().toISOString(),
      });
    });

    res.status(201).json(newTor);
  });

  // Update TOR (draft or revisions)
  app.put('/api/tors/:id', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const data = db.getData();
    const existing = data.tors.find((t) => t.id === id);

    if (!existing) {
      return res.status(404).json({ error: 'TOR tidak ditemukan' });
    }

    // Aturan Edit ToR:
    // - Direktur dapat mengedit dokumen ToR secara langsung kapan saja.
    // - R (Responsible) dan A1 (Accountable Program) dapat mengedit saat status Draft / Perlu Perbaikan, atau setelah meminta izin edit (Request Edit) dan di-ACC Direktur.
    const outputRaci = data.outputRaciRecords?.[existing.outputId];
    const isDirectorUser = currentUser.role === 'director';
    const isA2OrFinanceUser =
      currentUser.role === 'finance' ||
      (currentUser.roleTitle || '').toLowerCase().includes('finance') ||
      outputRaci?.accountableFinanceUserId === currentUser.id;
    const isRUser =
      currentUser.role !== 'admin' &&
      (outputRaci?.responsibleUserId === currentUser.id ||
        existing.picId === currentUser.id ||
        existing.createdById === currentUser.id);
    const isA1User =
      currentUser.role !== 'admin' &&
      (outputRaci?.accountableUserId === currentUser.id ||
        (!outputRaci?.accountableUserId && currentUser.role === 'program_manager'));

    const hasApprovedEditRequest = existing.editRequestStatus === 'approved';
    const isRevisionOrDraft =
      existing.submissionStatus === 'Draft' || existing.submissionStatus === 'Perlu Perbaikan';

    if (!isDirectorUser && !isA2OrFinanceUser && !isRUser && !isA1User) {
      return res.status(403).json({
        error:
          'Hanya Direktur (edit langsung), A2 / Finance (update estimasi budget), serta R dan A1 pada Output ini (melalui izin Request Edit) yang berwenang memperbarui dokumen ToR.',
      });
    }

    if (!isDirectorUser && !isA2OrFinanceUser && !hasApprovedEditRequest && !isRevisionOrDraft) {
      return res.status(400).json({
        error:
          'Dokumen bersifat final. Hanya Direktur atau A2/Finance (estimasi budget) yang dapat memperbarui langsung; R dan A1 wajib mengajukan Request Edit ke Direktur terlebih dahulu.',
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
      activityStatus,
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

    let updatedTor: Tor | null = null;
    db.update((d) => {
      const idx = d.tors.findIndex((t) => t.id === id);
      if (idx !== -1) {
        const wasApprovedEdit = d.tors[idx].editRequestStatus === 'approved';
        const keepUnlockedForRevision = d.tors[idx].submissionStatus === 'Perlu Perbaikan';
        d.tors[idx] = {
          ...d.tors[idx],
          // Rule 9: Nomor yang telah diterbitkan bersifat permanen, unik, dan tidak dapat diedit secara manual
          torNumber: existing.isOfficialNumber ? existing.torNumber : d.tors[idx].torNumber,
          isOfficialNumber: existing.isOfficialNumber,
          publishedAt: existing.publishedAt,
          torSequence: existing.torSequence,
          activityCode: existing.isOfficialNumber ? existing.activityCode : (req.body.activityCode || d.tors[idx].activityCode),
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
          participantType: req.body.participantType !== undefined ? req.body.participantType : (req.body.participantsType !== undefined ? req.body.participantsType : d.tors[idx].participantType),
          participantsType: req.body.participantType !== undefined ? req.body.participantType : (req.body.participantsType !== undefined ? req.body.participantsType : d.tors[idx].participantsType),
          participantsTarget: req.body.participantsTarget !== undefined ? req.body.participantsTarget : d.tors[idx].participantsTarget,
          participantsCount: req.body.participantsCount !== undefined ? (req.body.participantsCount !== null && req.body.participantsCount !== '' ? Number(req.body.participantsCount) : null) : d.tors[idx].participantsCount,
          participantsCriteria: req.body.participantsCriteria !== undefined ? req.body.participantsCriteria : d.tors[idx].participantsCriteria,
          participantTableMode: req.body.participantTableMode !== undefined ? req.body.participantTableMode : d.tors[idx].participantTableMode,
          participantRows: req.body.participantRows !== undefined ? req.body.participantRows : d.tors[idx].participantRows,
          participantCustomColumns: req.body.participantCustomColumns !== undefined ? req.body.participantCustomColumns : d.tors[idx].participantCustomColumns,
          goals: goals ?? d.tors[idx].goals,
          indicators: indicators ?? d.tors[idx].indicators,
          rolesResponsibilities: rolesResponsibilities ?? d.tors[idx].rolesResponsibilities,
          rolesNotes: req.body.rolesNotes !== undefined ? req.body.rolesNotes : (req.body.rolesAdditionalNotes !== undefined ? req.body.rolesAdditionalNotes : d.tors[idx].rolesNotes),
          rolesAdditionalNotes: req.body.rolesNotes !== undefined ? req.body.rolesNotes : (req.body.rolesAdditionalNotes !== undefined ? req.body.rolesAdditionalNotes : d.tors[idx].rolesAdditionalNotes),
          mealItems: mealItems ?? d.tors[idx].mealItems,
          rundown: rundown ?? d.tors[idx].rundown,
          rundownNotes: req.body.rundownNotes !== undefined ? req.body.rundownNotes : (req.body.rundownAdditionalNotes !== undefined ? req.body.rundownAdditionalNotes : d.tors[idx].rundownNotes),
          rundownAdditionalNotes: req.body.rundownNotes !== undefined ? req.body.rundownNotes : (req.body.rundownAdditionalNotes !== undefined ? req.body.rundownAdditionalNotes : d.tors[idx].rundownAdditionalNotes),
          challengesMitigations: challengesMitigations ?? d.tors[idx].challengesMitigations,
          challengesNotes: req.body.challengesNotes !== undefined ? req.body.challengesNotes : (req.body.challengesAdditionalNotes !== undefined ? req.body.challengesAdditionalNotes : d.tors[idx].challengesNotes),
          challengesAdditionalNotes: req.body.challengesNotes !== undefined ? req.body.challengesNotes : (req.body.challengesAdditionalNotes !== undefined ? req.body.challengesAdditionalNotes : d.tors[idx].challengesAdditionalNotes),
          activityDescription: activityDescription ?? d.tors[idx].activityDescription,
          expectedResults: expectedResults ?? d.tors[idx].expectedResults,
          location: location ?? d.tors[idx].location,
          locations: req.body.locations ?? d.tors[idx].locations,
          customPeriodId:
            req.body.customPeriodId !== undefined
              ? req.body.customPeriodId
              : d.tors[idx].customPeriodId,
          customPeriodCode:
            req.body.customPeriodCode !== undefined
              ? req.body.customPeriodCode
              : d.tors[idx].customPeriodCode,
          customPeriodLabel:
            req.body.customPeriodLabel !== undefined
              ? req.body.customPeriodLabel
              : d.tors[idx].customPeriodLabel,
          customPeriodStartDate:
            req.body.customPeriodStartDate !== undefined
              ? req.body.customPeriodStartDate
              : d.tors[idx].customPeriodStartDate,
          customPeriodEndDate:
            req.body.customPeriodEndDate !== undefined
              ? req.body.customPeriodEndDate
              : d.tors[idx].customPeriodEndDate,
          customPeriodAllocatedAmount:
            req.body.customPeriodAllocatedAmount !== undefined
              ? Number(req.body.customPeriodAllocatedAmount)
              : d.tors[idx].customPeriodAllocatedAmount,
          startDate: startDate ?? d.tors[idx].startDate,
          endDate: endDate ?? d.tors[idx].endDate,
          reportingPeriodType: reportingPeriodType ?? d.tors[idx].reportingPeriodType,
          reportingFrequency: reportingFrequency ?? d.tors[idx].reportingFrequency,
          reportingDeadline: reportingDeadline ?? d.tors[idx].reportingDeadline,
          additionalNotes: additionalNotes ?? d.tors[idx].additionalNotes,
          specificObjectives: req.body.specificObjectives !== undefined ? req.body.specificObjectives : d.tors[idx].specificObjectives,
          timelineItems: req.body.timelineItems !== undefined ? req.body.timelineItems : d.tors[idx].timelineItems,
          monitoringItems: req.body.monitoringItems !== undefined ? req.body.monitoringItems : d.tors[idx].monitoringItems,
          scopeOfActivities: req.body.scopeOfActivities !== undefined ? req.body.scopeOfActivities : d.tors[idx].scopeOfActivities,
          implementationMechanisms: req.body.implementationMechanisms !== undefined ? req.body.implementationMechanisms : d.tors[idx].implementationMechanisms,
          isRundownVisible: req.body.isRundownVisible !== undefined ? req.body.isRundownVisible : d.tors[idx].isRundownVisible,
          organizerPersonInCharge: req.body.organizerPersonInCharge !== undefined ? req.body.organizerPersonInCharge : d.tors[idx].organizerPersonInCharge,
          // Keep edit unlocked if still in Perlu Perbaikan; relock back to final ('none') otherwise
          editRequestStatus: keepUnlockedForRevision ? 'approved' : 'none',
          activityStatus: activityStatus ?? d.tors[idx].activityStatus,
          budgetRequested: req.body.budgetRequested !== undefined ? (req.body.budgetRequested !== null && req.body.budgetRequested !== '' ? Number(req.body.budgetRequested) : null) : d.tors[idx].budgetRequested,
          budgetApproved: req.body.budgetApproved !== undefined ? (req.body.budgetApproved !== null && req.body.budgetApproved !== '' ? Number(req.body.budgetApproved) : null) : d.tors[idx].budgetApproved,
          budgetActualSpent: req.body.budgetActualSpent !== undefined ? (req.body.budgetActualSpent !== null && req.body.budgetActualSpent !== '' ? Number(req.body.budgetActualSpent) : null) : d.tors[idx].budgetActualSpent,
          budgetNotes: req.body.budgetNotes ?? d.tors[idx].budgetNotes,
          budgetApprovalStatus:
            req.body.budgetApprovalStatus !== undefined
              ? req.body.budgetApprovalStatus
              : d.tors[idx].budgetApprovalStatus,
          budgetDeterminedByFinanceName:
            req.body.budgetDeterminedByFinanceName !== undefined
              ? req.body.budgetDeterminedByFinanceName
              : d.tors[idx].budgetDeterminedByFinanceName,
          budgetDeterminedByFinanceAt:
            req.body.budgetDeterminedByFinanceAt !== undefined
              ? req.body.budgetDeterminedByFinanceAt
              : d.tors[idx].budgetDeterminedByFinanceAt,
          budgetUpdatedByA2Name:
            req.body.budgetUpdatedByA2Name !== undefined
              ? req.body.budgetUpdatedByA2Name
              : d.tors[idx].budgetUpdatedByA2Name,
          budgetUpdatedByA2At:
            req.body.budgetUpdatedByA2At !== undefined
              ? req.body.budgetUpdatedByA2At
              : d.tors[idx].budgetUpdatedByA2At,
          budgetApprovedByDirectorName:
            req.body.budgetApprovedByDirectorName !== undefined
              ? req.body.budgetApprovedByDirectorName
              : d.tors[idx].budgetApprovedByDirectorName,
          budgetApprovedByDirectorAt:
            req.body.budgetApprovedByDirectorAt !== undefined
              ? req.body.budgetApprovedByDirectorAt
              : d.tors[idx].budgetApprovedByDirectorAt,
          budgetAuditLogs:
            Array.isArray(req.body.budgetAuditLogs)
              ? req.body.budgetAuditLogs
              : d.tors[idx].budgetAuditLogs,
          updatedAt: new Date().toISOString(),
        };
        updatedTor = d.tors[idx];
        const masterTor = d.tors[idx];

        // Controlled Modification (Rule 7): Synchronize references across all impacted downstream stages
        if (Array.isArray(d.cashAdvances)) {
          d.cashAdvances = d.cashAdvances.map((ca) => {
            if (ca.torId !== id) return ca;
            const tlList = masterTor.timelineItems || [];
            const updatedItems = (ca.items || []).map((item) => {
              const matchedTl = tlList.find((t) => t.id === item.timelineItemId);
              return matchedTl
                ? {
                    ...item,
                    timelinePeriod: matchedTl.period,
                    timelineActivity: matchedTl.activity,
                  }
                : item;
            });
            return {
              ...ca,
              torNumber: masterTor.torNumber,
              activityTitle: masterTor.title,
              programName: masterTor.programName || ca.programName,
              activityStartDate: masterTor.startDate,
              activityEndDate: masterTor.endDate,
              location: masterTor.location || ca.location,
              items: updatedItems,
            };
          });
        }

        if (d.cashAdvanceSummaries && d.cashAdvanceSummaries[id]) {
          const tlList = masterTor.timelineItems || [];
          const sumObj = d.cashAdvanceSummaries[id];
          if (Array.isArray(sumObj.summaryRows)) {
            sumObj.summaryRows = sumObj.summaryRows.map((row: any) => {
              const matchedTl = tlList.find((t) => t.id === row.timelineItemId);
              return matchedTl
                ? {
                    ...row,
                    timelinePeriod: matchedTl.period,
                    timelineActivity: matchedTl.activity,
                  }
                : row;
            });
          }
        }

        if (Array.isArray(d.meetingMinutes)) {
          d.meetingMinutes = d.meetingMinutes.map((mm) => {
            if (mm.torId !== id) return mm;
            return {
              ...mm,
              torNumber: masterTor.torNumber,
              meetingLocation: masterTor.location || mm.meetingLocation,
            };
          });
        }

        if (wasApprovedEdit || currentUser.role === 'director') {
          d.approvalRecords.push({
            id: `app-${Date.now()}`,
            torId: id,
            stage: 'Akses Edit',
            action: 'Simpan Edit',
            actorId: currentUser.id,
            actorName: currentUser.name,
            actorRole: currentUser.role,
            comment: 'Perubahan dokumen Master TOR telah disimpan dan referensi seluruh tahapan hilir (Tahap 2–8) telah diperbarui.',
            timestamp: new Date().toISOString(),
            resultingStatus: d.tors[idx].submissionStatus,
          });
        }

        syncApprovalHubData(d);
      }
    });

    res.json(updatedTor);
  });

  // Update / ACC Estimasi Budget ToR (Ditentukan oleh Finance, Diupdate oleh A2, Di-ACC oleh Direktur)
  app.post('/api/tors/:id/budget-estimate', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const { action, budgetRequested, budgetNotes } = req.body as {
      action: 'finance_determine' | 'a2_update' | 'director_acc';
      budgetRequested?: number;
      budgetNotes?: string;
    };

    const data = db.getData();
    const existing = data.tors.find((t) => t.id === id);
    if (!existing) {
      return res.status(404).json({ error: 'TOR tidak ditemukan' });
    }

    const nowIso = new Date().toISOString();
    const numericBudget =
      budgetRequested !== undefined && budgetRequested !== null && !isNaN(Number(budgetRequested))
        ? Number(budgetRequested)
        : Number(existing.budgetApproved || existing.budgetRequested || 0);

    let updatedTor: Tor | null = null;
    db.update((d) => {
      const idx = d.tors.findIndex((t) => t.id === id);
      if (idx === -1) return;
      const cur = d.tors[idx];
      const existingLogs = Array.isArray(cur.budgetAuditLogs) ? cur.budgetAuditLogs : [];

      if (action === 'director_acc') {
        const logEntry = {
          id: `bgt-log-${Date.now()}`,
          timestamp: nowIso,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle || 'Executive Director',
          actionLabel: `ACC Estimasi Budget ToR oleh Direktur — Budget yang disetujui untuk ini adalah Rp ${numericBudget.toLocaleString('id-ID')}`,
          amount: numericBudget,
          status: 'Disetujui Direktur',
        };
        d.tors[idx] = {
          ...cur,
          budgetApproved: numericBudget,
          budgetApprovalStatus: 'Disetujui Direktur',
          budgetApprovedByDirectorName: currentUser.name,
          budgetApprovedByDirectorAt: nowIso,
          budgetNotes: budgetNotes !== undefined ? budgetNotes : cur.budgetNotes,
          budgetAuditLogs: [logEntry, ...existingLogs],
          updatedAt: nowIso,
        };
      } else {
        const isFirstDetermine = action === 'finance_determine' || !cur.budgetDeterminedByFinanceName;
        const logEntry = {
          id: `bgt-log-${Date.now()}`,
          timestamp: nowIso,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle || 'A2 – Accountable Finance',
          actionLabel: isFirstDetermine
            ? `Penentuan Estimasi Budget ToR oleh Finance (Rp ${numericBudget.toLocaleString('id-ID')}) — Menunggu ACC Direktur`
            : `Update Estimasi Budget ToR oleh A2 / Finance (Rp ${numericBudget.toLocaleString('id-ID')}) — Menunggu ACC Direktur`,
          amount: numericBudget,
          status: 'Menunggu ACC Direktur',
        };
        d.tors[idx] = {
          ...cur,
          budgetApproved: numericBudget,
          budgetApprovalStatus: 'Menunggu ACC Direktur',
          budgetDeterminedByFinanceName: cur.budgetDeterminedByFinanceName || currentUser.name,
          budgetDeterminedByFinanceAt: cur.budgetDeterminedByFinanceAt || nowIso,
          budgetUpdatedByA2Name: currentUser.name,
          budgetUpdatedByA2At: nowIso,
          budgetNotes: budgetNotes !== undefined ? budgetNotes : cur.budgetNotes,
          budgetAuditLogs: [logEntry, ...existingLogs],
          updatedAt: nowIso,
        };
      }

      updatedTor = d.tors[idx];
      d.auditLogs.unshift({
        id: `log-bgt-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action:
          action === 'director_acc'
            ? 'ACC Estimasi Budget ToR (Direktur)'
            : 'Update Estimasi Budget ToR (Finance / A2)',
        entityType: 'TOR',
        entityId: id,
        details: `${d.tors[idx].torNumber}: Estimasi Kebutuhan Anggaran Rp ${numericBudget.toLocaleString('id-ID')} (${d.tors[idx].budgetApprovalStatus}).`,
        timestamp: nowIso,
      });
      syncApprovalHubData(d);
    });

    res.json(updatedTor);
  });

  // Request Edit Access to Director (Terintegrasi penuh ke dalam Approval ToR / apv-tor-:id)
  app.post('/api/tors/:id/request-edit', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const { reason } = req.body;
    const data = db.getData();
    const tor = data.tors.find((t) => t.id === id);

    if (!tor) return res.status(404).json({ error: 'TOR tidak ditemukan' });
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Alasan permintaan edit wajib diisi' });
    }

    try {
      let updatedTor: Tor | null = null;
      let hubMessage = '';
      db.update((d) => {
        const result = executeApprovalHubAction({
          draft: d,
          itemId: `apv-tor-${id}`,
          actor: currentUser,
          action: 'request_edit',
          comment: reason.trim(),
        });
        hubMessage = result.message;
        updatedTor = d.tors.find((t) => t.id === id) || null;
      });

      res.json({
        message:
          hubMessage ||
          'Permintaan edit berhasil masuk ke Approval ToR dan menunggu keputusan (ACC Edit) Direktur.',
        tor: updatedTor,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Gagal mengajukan permintaan edit ToR.' });
    }
  });

  // Director Review (ACC / Tolak) Edit Request (Terintegrasi penuh dengan Approval ToR / apv-tor-:id)
  app.post('/api/tors/:id/review-edit-request', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const { decision, comment } = req.body as { decision: 'approve' | 'reject'; comment?: string };

    if (currentUser.role !== 'director') {
      return res.status(403).json({
        error: 'Hanya Director yang berwenang menyetujui (ACC) atau menolak permintaan edit TOR.',
      });
    }

    const data = db.getData();
    const tor = data.tors.find((t) => t.id === id);
    if (!tor) return res.status(404).json({ error: 'TOR tidak ditemukan' });

    const isApprove = decision === 'approve';
    try {
      let updatedTor: Tor | null = null;
      let hubMessage = '';
      db.update((d) => {
        const result = executeApprovalHubAction({
          draft: d,
          itemId: `apv-tor-${id}`,
          actor: currentUser,
          action: isApprove ? 'approve_edit_request' : 'reject_edit_request',
          comment: comment?.trim(),
        });
        hubMessage = result.message;
        updatedTor = d.tors.find((t) => t.id === id) || null;
      });

      res.json({
        message:
          hubMessage ||
          (isApprove
            ? 'Permintaan edit berhasil di-ACC melalui Approval ToR. Dokumen kini dapat diedit.'
            : 'Permintaan edit telah ditolak melalui Approval ToR.'),
        tor: updatedTor,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Gagal memproses keputusan Request Edit ToR.' });
    }
  });

  // Submit TOR (from Draft or Perlu Perbaikan -> A1 Accountable Program)
  app.post('/api/tors/:id/submit', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const { comment } = req.body;
    const data = db.getData();
    const tor = data.tors.find((t) => t.id === id);

    if (!tor) return res.status(404).json({ error: 'TOR tidak ditemukan' });

    if (
      tor.createdById !== currentUser.id &&
      tor.picId !== currentUser.id &&
      currentUser.role !== 'director'
    ) {
      return res.status(403).json({ error: 'Hanya pembuat / PIC TOR yang dapat mengajukan dokumen' });
    }

    if (tor.submissionStatus !== 'Draft' && tor.submissionStatus !== 'Perlu Perbaikan') {
      return res.status(400).json({ error: `TOR berstatus '${tor.submissionStatus}' tidak dapat diajukan kembali` });
    }

    let generatedOfficialNumber = tor.torNumber;
    let finalSubmissionStatus: SubmissionStatus = 'Menunggu Persetujuan Finance';

    try {
      db.update((d) => {
        const idx = d.tors.findIndex((t) => t.id === id);
        if (idx !== -1) {
          const targetTor = d.tors[idx];

          if (!targetTor.isOfficialNumber) {
            const prog = d.programs.find((p) => p.id === targetTor.programId);
            const progName = prog?.name || targetTor.programName || 'Program';
            const progCode = generateProgramCode(progName, prog?.code);

            const { hierarchyCode } = computeHierarchyCode({
              programId: targetTor.programId,
              outcomeId: targetTor.outcomeId,
              outputId: targetTor.outputId,
              activityId: targetTor.activityId,
              outcomes: d.outcomes,
              outputs: d.outputs,
              activities: d.activities,
            });

            const now = new Date();
            const year = now.getFullYear();
            const nextSeq = getNextTorSequenceForYear(d, year);
            const romanMonth = getRomanMonth(now);

            generatedOfficialNumber = formatTorNumber({
              sequence: nextSeq,
              programCode: progCode,
              hierarchyCode,
              romanMonth,
              year,
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

        // Delegate to executeApprovalHubAction so ApprovalHub status, version, timeline, and A1 notifications are 100% synced
        executeApprovalHubAction({
          draft: d,
          itemId: `apv-tor-${id}`,
          actor: currentUser,
          action: 'submit',
          comment: comment || undefined,
        });

        const updatedTor = d.tors.find((t) => t.id === id);
        if (updatedTor) {
          finalSubmissionStatus = updatedTor.submissionStatus;
          generatedOfficialNumber = updatedTor.torNumber;
        }
      });

      res.json({
        message: 'TOR berhasil diajukan ke A1 (Accountable Program)',
        submissionStatus: finalSubmissionStatus,
        torNumber: generatedOfficialNumber,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Gagal mengajukan TOR' });
    }
  });

  // Review TOR (Approve / Reject / Request Revision — Terintegrasi dengan ApprovalHub R -> A1 -> Director)
  app.post('/api/tors/:id/review', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const { action, comment } = req.body;

    if (!action || !['Setujui', 'Tolak', 'Minta Perbaikan'].includes(action)) {
      return res.status(400).json({ error: "Tindakan harus salah satu dari: 'Setujui', 'Tolak', 'Minta Perbaikan'" });
    }

    if ((action === 'Tolak' || action === 'Minta Perbaikan') && (!comment || !comment.trim())) {
      return res.status(400).json({ error: 'Alasan dan komentar pemeriksa wajib diisi untuk penolakan atau permintaan perbaikan' });
    }

    const data = db.getData();
    const tor = data.tors.find((t) => t.id === id);

    if (!tor) return res.status(404).json({ error: 'TOR tidak ditemukan' });

    if (tor.createdById === currentUser.id && currentUser.role !== 'director') {
      return res.status(403).json({ error: 'Pelanggaran Aturan: Pembuat TOR tidak diperbolehkan menyetujui dokumen yang dibuatnya sendiri.' });
    }

    try {
      let resultingStatus: SubmissionStatus = tor.submissionStatus;
      let hubMessage = '';

      db.update((d) => {
        syncApprovalHubData(d);
        const hubItem = d.approvalHubItems?.[`apv-tor-${id}`];
        if (!hubItem) {
          throw new Error('Item Approval ToR tidak ditemukan.');
        }

        let hubAction: 'verify_approve' | 'director_final_approve' | 'revision' | 'reject';
        if (action === 'Minta Perbaikan') {
          hubAction = 'revision';
        } else if (action === 'Tolak') {
          hubAction = 'reject';
        } else {
          // action === 'Setujui'
          if (
            currentUser.role === 'director' &&
            (hubItem.status === 'Pending Approval' ||
              hubItem.status === 'Approved' ||
              tor.submissionStatus === 'Menunggu Persetujuan Director')
          ) {
            hubAction = 'director_final_approve';
          } else {
            hubAction = 'verify_approve';
          }
        }

        const result = executeApprovalHubAction({
          draft: d,
          itemId: `apv-tor-${id}`,
          actor: currentUser,
          action: hubAction,
          comment: comment?.trim(),
        });

        hubMessage = result.message;
        const updatedTor = d.tors.find((t) => t.id === id);
        if (updatedTor) {
          resultingStatus = updatedTor.submissionStatus;
        }
      });

      return res.json({
        message: hubMessage || `Tindakan '${action}' berhasil diproses`,
        submissionStatus: resultingStatus,
      });
    } catch (err: any) {
      return res.status(400).json({
        error: err.message || 'Gagal memproses peninjauan ToR.',
      });
    }
  });

  // Update Activity Status (e.g. Belum Dimulai -> Sedang Berjalan -> Selesai)
  app.put('/api/tors/:id/activity-status', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const { activityStatus } = req.body;

    if (!['Belum Dimulai', 'Sedang Berjalan', 'Selesai'].includes(activityStatus)) {
      return res.status(400).json({ error: 'Status kegiatan tidak valid' });
    }

    const data = db.getData();
    const tor = data.tors.find((t) => t.id === id);
    if (!tor) return res.status(404).json({ error: 'TOR tidak ditemukan' });

    // Only PIC, creator, PM, or Director can update activity status
    if (
      tor.picId !== currentUser.id &&
      tor.createdById !== currentUser.id &&
      currentUser.role !== 'director' &&
      currentUser.role !== 'program_manager'
    ) {
      return res.status(403).json({ error: 'Hanya PIC atau Pengelola Program yang dapat mengubah status pelaksanaan kegiatan' });
    }

    db.update((d) => {
      const idx = d.tors.findIndex((t) => t.id === id);
      if (idx !== -1) {
        d.tors[idx].activityStatus = activityStatus;
        d.tors[idx].updatedAt = new Date().toISOString();
      }

      d.auditLogs.unshift({
        id: `log-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: 'Pembaruan Status Kegiatan',
        entityType: 'TOR',
        entityId: tor.id,
        details: `${tor.torNumber} status kegiatan diubah menjadi: ${activityStatus}`,
        timestamp: new Date().toISOString(),
      });
    });

    res.json({ message: 'Status kegiatan berhasil diperbarui', activityStatus });
  });

  // Delete TOR (Strictly Director Only)
  app.delete('/api/tors/:id', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;

    if (currentUser.role !== 'director') {
      return res.status(403).json({
        error: 'Hanya Direktur yang memiliki kewenangan untuk menghapus dokumen ToR.',
      });
    }

    const data = db.getData();
    const targetTor = (data.tors || []).find((t) => t.id === id);
    if (!targetTor) {
      return res.status(404).json({ error: 'Dokumen ToR tidak ditemukan.' });
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
        action: 'Penghapusan Dokumen TOR (Direktur)',
        entityType: 'TOR',
        entityId: id,
        details: `Direktur (${currentUser.name}) menghapus dokumen TOR ${targetTor.torNumber}: "${targetTor.title}" beserta dokumen turunan terkait.`,
        timestamp: new Date().toISOString(),
      });
    });

    res.json({
      message: `Dokumen ToR ${targetTor.torNumber} berhasil dihapus oleh Direktur.`,
      id,
    });
  });

  // ==========================================
  // CASH ADVANCE (KASBON OPERASIONAL) ENDPOINTS
  // ==========================================

  // Get all cash advances (supports ?torId=... & ?search=...)
  app.get('/api/cash-advances', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const { torId, search, status } = req.query;
    const data = db.getData();
    let records = data.cashAdvances || [];

    if (currentUser.role === 'staff' && !currentUser.permissions?.canViewAllTors) {
      records = records.filter((ca) => {
        if (ca.requesterId === currentUser.id) return true;
        const linkedTor = data.tors.find((t) => t.id === ca.torId);
        return linkedTor ? canUserAccessTorRecord(currentUser, linkedTor, data) : false;
      });
    }

    if (torId) {
      records = records.filter((ca) => ca.torId === String(torId));
    }
    if (status && status !== 'all') {
      records = records.filter((ca) => ca.status === String(status));
    }
    if (search && typeof search === 'string' && search.trim().length > 0) {
      const q = search.toLowerCase();
      records = records.filter(
        (ca) =>
          ca.advanceNumber.toLowerCase().includes(q) ||
          ca.torNumber.toLowerCase().includes(q) ||
          ca.activityTitle.toLowerCase().includes(q) ||
          ca.requesterName.toLowerCase().includes(q)
      );
    }

    // Sort by createdAt descending
    records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json(records);
  });

  // Get single cash advance
  app.get('/api/cash-advances/:id', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const data = db.getData();
    const ca = (data.cashAdvances || []).find((c) => c.id === id);
    if (!ca) {
      return res.status(404).json({ error: 'Cash Advance tidak ditemukan' });
    }
    if (currentUser.role === 'staff' && !currentUser.permissions?.canViewAllTors) {
      const linkedTor = data.tors.find((t) => t.id === ca.torId);
      const canView =
        ca.requesterId === currentUser.id ||
        (linkedTor ? canUserAccessTorRecord(currentUser, linkedTor, data) : false);
      if (!canView) {
        return res.status(403).json({
          error: 'Akses ditolak: Anda tidak memiliki izin untuk melihat dokumen Cash Advance ini.',
        });
      }
    }
    res.json(ca);
  });

  // Create new cash advance
  app.post('/api/cash-advances', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const body = req.body;

    if (!body.torId) {
      return res.status(400).json({ error: 'Referensi Dokumen TOR wajib dipilih' });
    }

    const data = db.getData();
    const targetTor = data.tors.find((t) => t.id === body.torId);
    if (!targetTor) {
      return res.status(400).json({ error: 'TOR referensi tidak valid' });
    }

    const existingForTor = (data.cashAdvances || []).filter((c) => c.torId === targetTor.id);
    const unreportedForTor = existingForTor.filter((c) => !c.isReported && c.status !== 'Ditolak');

    if (unreportedForTor.length >= 2) {
      return res.status(400).json({
        error:
          'Tidak dapat mengajukan Cash Advance baru karena masih terdapat 2 Cash Advance yang belum dilaporkan. Silakan tutup laporan pada menu Ringkasan Cash Advance beserta lampiran link PDF Expensify terlebih dahulu.',
      });
    }

    const now = new Date();
    const requestDateStr = body.requestDate || now.toISOString().slice(0, 10);
    const reqDateObj = new Date(requestDateStr);
    if (isNaN(reqDateObj.getTime())) {
      reqDateObj.setTime(now.getTime());
    }
    const deadlineObj = new Date(reqDateObj.getTime() + 7 * 24 * 60 * 60 * 1000);
    const calculatedDeadlineStr = deadlineObj.toISOString().slice(0, 10);

    // Generate sequential number based on TOR Number
    const cleanTor = (targetTor.torNumber || '').trim();
    let baseCa = '';
    if (/^TOR\//i.test(cleanTor)) baseCa = cleanTor.replace(/^TOR\//i, 'CA/');
    else if (/^TOR\-/i.test(cleanTor)) baseCa = cleanTor.replace(/^TOR\-/i, 'CA-');
    else if (/^TOR\_/i.test(cleanTor)) baseCa = cleanTor.replace(/^TOR\_/i, 'CA_');
    else if (/^TOR\./i.test(cleanTor)) baseCa = cleanTor.replace(/^TOR\./i, 'CA.');
    else if (/^TOR/i.test(cleanTor)) baseCa = cleanTor.replace(/^TOR/i, 'CA/');
    else baseCa = `CA/${cleanTor}`;

    const seq = existingForTor.length + 1;
    const seqSuffix = `.${String(seq).padStart(2, '0')}`;
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
    const newRecord: CashAdvanceRecord = {
      id: newId,
      advanceNumber: body.advanceNumber || autoNumber,
      requestDate: requestDateStr,
      organizationName: 'Yayasan Inti Muda Indonesia (WIJNA)',
      requesterId: currentUser.id,
      requesterName: currentUser.name,
      requesterRole: currentUser.roleTitle,
      department: currentUser.department || 'Program & Implementasi Lapangan',
      torId: targetTor.id,
      torNumber: targetTor.torNumber,
      activityTitle: targetTor.title,
      programName: targetTor.programName || 'Program Yayasan Inti Muda Indonesia',
      activityStartDate: targetTor.startDate,
      activityEndDate: targetTor.endDate,
      location: targetTor.location || body.location || '',
      bankName: body.bankName || 'Bank Mandiri',
      bankAccountNumber: body.bankAccountNumber || '',
      bankAccountHolder: body.bankAccountHolder || currentUser.name,
      items: Array.isArray(body.items) ? body.items : [],
      totalAmount: Number(body.totalAmount) || 0,
      amountInWords: body.amountInWords || '',
      complianceNotes: body.complianceNotes || [
        '1. Dilaporkan paling lambat 7 (tujuh) hari setelah pengajuan dana disertai lampiran link PDF Expensify.',
        '2. Tidak dapat mengajukan Cash Advance baru apabila masih terdapat 2 Cash Advance yang belum dilaporkan.',
        '3. Sisa saldo kasbon yang tidak terpakai wajib dikembalikan ke rekening kas organisasi saat rekonsiliasi.',
      ],
      implementationMode: body.implementationMode === 'single' ? 'single' : 'all',
      implementationTimelineIds: Array.isArray(body.implementationTimelineIds) ? body.implementationTimelineIds : [],
      implementationTimelineSummary: body.implementationTimelineSummary || 'Seluruh Tahapan Implementation Timeline',
      reportingCommitment: body.reportingCommitment || 'Dilaporkan paling lambat 7 (tujuh) hari setelah pengajuan dana',
      reportingDeadlineDate: body.reportingDeadlineDate || calculatedDeadlineStr,
      isReported: false,
      signatures: {
        requestedBy: {
          name: currentUser.name,
          roleTitle: currentUser.roleTitle,
          date: now.toISOString().slice(0, 10),
          status: body.status === 'Diajukan' ? 'Diajukan' : 'Draft',
          signatureNote: body.requestedNote || 'Pengajuan uang muka operasional diajukan secara resmi.',
        },
        verifiedBy: {
          name: '',
          roleTitle: 'Finance Specialist',
          date: '',
          status: 'Pending',
          notes: '',
        },
        approvedBy: {
          name: '',
          roleTitle: 'Director',
          date: '',
          status: 'Pending',
          notes: '',
        },
      },
      status: (body.status as any) || 'Draft',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    db.update((draft) => {
      if (!draft.cashAdvances) draft.cashAdvances = [];
      draft.cashAdvances.push(newRecord);
      syncTorBudgetInDraft(draft, targetTor.id);
      syncApprovalHubData(draft);

      if (newRecord.status === 'Diajukan') {
        const hubItem = draft.approvalHubItems?.[`apv-ca-${newRecord.id}`];
        if (hubItem) {
          if (!draft.approvalNotifications) draft.approvalNotifications = [];
          draft.approvalNotifications = draft.approvalNotifications.filter(
            (n) => n.id !== `notif-init-${hubItem.id}` && n.approvalItemId !== hubItem.id
          );
          const a2Targets = [hubItem.accountableFinanceUserId].filter(
            (uid): uid is string => Boolean(uid)
          );
          draft.approvalNotifications.unshift({
            id: `notif-ca-create-${Date.now()}`,
            approvalItemId: hubItem.id,
            referenceNumber: newRecord.advanceNumber,
            documentTitle: `Cash Advance: ${newRecord.activityTitle}`,
            categoryCode: 'cash_advance',
            categoryLabel: 'Cash Advance Request',
            eventType: 'NEW_SUBMISSION',
            message: `[Cash Advance Request] "${newRecord.activityTitle}" (${newRecord.advanceNumber}) telah diajukan oleh ${currentUser.name} dan menunggu verifikasi Finance (A2: ${hubItem.accountableFinanceUserName || 'Finance'}).`,
            targetUserIds: a2Targets,
            targetRoleCodes: ['A2'],
            createdAt: now.toISOString(),
            isReadByUserIds: [],
          });
        }
      }

      draft.auditLogs.unshift({
        id: `log-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: 'Pembuatan Formulir Cash Advance',
        entityType: 'TOR',
        entityId: targetTor.id,
        details: `Formulir ${newRecord.advanceNumber} (${newRecord.implementationTimelineSummary}) dibuat untuk TOR ${targetTor.torNumber} senilai ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(newRecord.totalAmount)}. Batas pelaporan H+7: ${newRecord.reportingDeadlineDate}`,
        timestamp: now.toISOString(),
      });
    });

    res.status(201).json(newRecord);
  });

  // Close Cash Advance Report ("Tutup Laporan" in Ringkasan Cash Advance + Mandatory Expensify PDF Link)
  app.post('/api/cash-advances/:id/close-report', (req: Request, res: Response) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);
    const { expensifyPdfLink, realizedAmount, reportNotes, itemRealizations } = req.body;
    const now = new Date();
    const nowIso = now.toISOString();

    if (!expensifyPdfLink || typeof expensifyPdfLink !== 'string' || !expensifyPdfLink.trim()) {
      return res.status(400).json({
        error: 'Kewajiban melampirkan Link PDF Expensify wajib diisi sebelum menutup laporan Cash Advance.',
      });
    }

    let updatedRecord: CashAdvanceRecord | null = null;
    db.update((draft) => {
      if (!draft.cashAdvances) return;
      const found = draft.cashAdvances.find((c) => c.id === id);
      if (!found) return;

      // Update item actualSpent if provided
      if (itemRealizations && typeof itemRealizations === 'object' && Array.isArray(found.items)) {
        found.items = found.items.map((it) => {
          const val = itemRealizations[it.id];
          if (val !== undefined && !isNaN(Number(val))) {
            return { ...it, actualSpent: Math.max(0, Number(val)) };
          }
          return it;
        });
      }

      const computedRealized =
        realizedAmount !== undefined && !isNaN(Number(realizedAmount))
          ? Math.max(0, Number(realizedAmount))
          : (found.items || []).reduce((sum, it) => sum + (Number(it.actualSpent) || 0), 0);

      found.isReported = true;
      found.reportedAt = nowIso;
      found.reportedByName = found.requesterName || currentUser.name;
      found.expensifyPdfLink = expensifyPdfLink.trim();
      found.realizedAmount = computedRealized;
      found.reportNotes = reportNotes ? String(reportNotes).trim() : '';
      found.reportApprovalStatus = 'Menunggu Pemeriksaan Finance';
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
          actorRoleCode: 'R',
          actorRoleTitle: currentUser.roleTitle || 'PIC Kegiatan',
          responsibleName: found.requesterName,
          actionLabel: 'Mengirimkan Final Financial Report ke Finance (A2)',
          resultingStatus: 'Pending Verification',
          comment:
            found.reportNotes ||
            `Laporan pertanggungjawaban dikirim dengan realisasi Rp ${computedRealized.toLocaleString('id-ID')} & lampiran PDF Expensify.`,
          version: finHubItem.version || 1,
        });

        if (!draft.approvalNotifications) draft.approvalNotifications = [];
        const a2Targets = [finHubItem.accountableFinanceUserId].filter(
          (uid): uid is string => Boolean(uid)
        );
        draft.approvalNotifications.unshift({
          id: `notif-finrep-sub-${Date.now()}`,
          approvalItemId: finHubItem.id,
          referenceNumber: finHubItem.referenceNumber,
          documentTitle: finHubItem.title,
          categoryCode: 'laporan_keuangan_akhir',
          categoryLabel: 'Final Financial Report',
          eventType: 'NEW_SUBMISSION',
          message: `[Final Financial Report] "${finHubItem.title}" (${finHubItem.referenceNumber}) telah dikirim oleh ${currentUser.name} dan menunggu verifikasi Finance (A2: ${finHubItem.accountableFinanceUserName || 'Finance'}).`,
          targetUserIds: a2Targets,
          targetRoleCodes: ['A2'],
          createdAt: nowIso,
          isReadByUserIds: [],
        });
      }

      // Record in TOR-specific Cash Advance audit trail
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
      const pct = found.totalAmount > 0 ? Math.round((computedRealized / found.totalAmount) * 100) : 0;

      draft.cashAdvanceAuditLogs[found.torId].unshift({
        id: `audit-close-${Date.now()}`,
        torId: found.torId,
        timestamp: nowIso,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.role,
        action: 'Tutup Laporan Cash Advance (Expensify PDF)',
        details: `Menutup laporan ${found.advanceNumber} (${found.implementationTimelineSummary || 'Implementasi'}) dengan Realisasi Rp ${computedRealized.toLocaleString('id-ID')} dan lampiran Link PDF Expensify: ${found.expensifyPdfLink}. Status: Menunggu Pemeriksaan Finance.`,
        totalAdvance: found.totalAmount,
        totalSpent: computedRealized,
        totalRemaining: remaining,
        totalShortage: shortage,
        percentUsed: pct,
        itemCount: (found.items || []).length,
      });

      draft.auditLogs.unshift({
        id: `log-close-ca-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: 'Tutup Laporan Cash Advance',
        entityType: 'TOR',
        entityId: found.torId,
        details: `Laporan Cash Advance ${found.advanceNumber} telah ditutup oleh ${currentUser.name}. Realisasi: Rp ${computedRealized.toLocaleString('id-ID')}. Link PDF Expensify: ${found.expensifyPdfLink}`,
        timestamp: nowIso,
      });
    });

    if (!updatedRecord) {
      return res.status(404).json({ error: 'Cash Advance tidak ditemukan' });
    }
    res.json(updatedRecord);
  });

  // Approve Closed Cash Advance Report (Sequential: Finance A2 -> Director)
  app.post('/api/cash-advances/:id/approve-report', (req: Request, res: Response) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);
    const { stage, action, notes } = req.body; // stage: 'finance' | 'director', action: 'approve' | 'revision'
    const now = new Date();
    const nowIso = now.toISOString();

    let updatedRecord: CashAdvanceRecord | null = null;
    try {
      db.update((draft) => {
        if (!draft.cashAdvances) return;
        const found = draft.cashAdvances.find((c) => c.id === id);
        if (!found) return;

        if (!found.isReported) {
          throw new Error('Laporan keuangan belum dikirimkan oleh Responsible (R).');
        }

        if (stage === 'finance') {
          if (currentUser.role !== 'finance' && currentUser.role !== 'admin') {
            throw new Error('Hanya Finance (A2) yang berwenang memverifikasi laporan keuangan akhir.');
          }
          if (found.reportApprovalStatus === 'Telah Disetujui') {
            throw new Error('Laporan keuangan sudah disetujui akhir dan tidak dapat diubah.');
          }
          if (action === 'revision') {
            found.reportApprovalStatus = 'Perlu Revisi';
            found.reportVerifiedByName = currentUser.name;
            found.reportVerifiedAt = nowIso;
            found.reportVerifiedNotes = notes || 'Laporan perlu diperbaiki.';
          } else {
            found.reportApprovalStatus = 'Menunggu Persetujuan Director';
            found.reportVerifiedByName = currentUser.name;
            found.reportVerifiedAt = nowIso;
            found.reportVerifiedNotes = notes || 'Laporan realisasi & lampiran Expensify telah diperiksa Finance.';
          }
        } else if (stage === 'director') {
          if (currentUser.role !== 'director' && currentUser.role !== 'admin') {
            throw new Error('Hanya Executive Director yang berwenang memberikan persetujuan akhir laporan keuangan.');
          }
          if (found.reportApprovalStatus !== 'Menunggu Persetujuan Director' && action !== 'revision') {
            throw new Error('Laporan keuangan harus diverifikasi oleh Finance (A2) terlebih dahulu sebelum disetujui Direktur.');
          }
          if (action === 'revision') {
            found.reportApprovalStatus = 'Perlu Revisi';
            found.reportApprovedByName = currentUser.name;
            found.reportApprovedAt = nowIso;
            found.reportApprovedNotes = notes || 'Laporan perlu revisi dari Director.';
          } else {
            found.reportApprovalStatus = 'Telah Disetujui';
            found.reportApprovedByName = currentUser.name;
            found.reportApprovedAt = nowIso;
            found.reportApprovedNotes = notes || 'Penutupan laporan Cash Advance telah disetujui Executive Director.';
          }
        }

        found.updatedAt = nowIso;
        updatedRecord = found;
        syncTorBudgetInDraft(draft, found.torId);
        syncApprovalHubData(draft);

        const finHubItem = draft.approvalHubItems?.[`apv-finrep-${found.id}`];
        const parentTor = (draft.tors || []).find((t) => t.id === found.torId);
        const directorIds = (draft.users || [])
          .filter((u) => u.role === 'director' && u.isActive !== false)
          .map((u) => u.id);
        const reqTargets: string[] = Array.from(
          new Set(
            [found.requesterId, parentTor?.picId, parentTor?.createdById].filter(
              (uid): uid is string => Boolean(uid)
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
            actorRoleCode: stage === 'finance' ? 'A2' : 'Direktur',
            actorRoleTitle: currentUser.roleTitle || (stage === 'finance' ? 'Finance Specialist' : 'Executive Director'),
            responsibleName: found.requesterName,
            actionLabel:
              action === 'revision'
                ? `Mengembalikan Final Financial Report untuk Revisi (${stage === 'finance' ? 'A2' : 'Direktur'})`
                : stage === 'finance'
                ? 'Memverifikasi Final Financial Report (Tahap A2) -> Diteruskan ke Direktur'
                : 'Menyetujui Akhir Final Financial Report (Direktur)',
            resultingStatus: finHubItem.status,
            comment:
              notes ||
              (stage === 'finance'
                ? found.reportVerifiedNotes || 'Diverifikasi oleh Finance.'
                : found.reportApprovedNotes || 'Disetujui oleh Direktur.'),
            version: finHubItem.version || 1,
          });

          if (!draft.approvalNotifications) draft.approvalNotifications = [];
          draft.approvalNotifications.unshift({
            id: `notif-finrep-${stage}-${Date.now()}`,
            approvalItemId: finHubItem.id,
            referenceNumber: finHubItem.referenceNumber,
            documentTitle: finHubItem.title,
            categoryCode: 'laporan_keuangan_akhir',
            categoryLabel: 'Final Financial Report',
            eventType:
              action === 'revision'
                ? 'REVISION_REQUIRED'
                : stage === 'finance'
                ? 'ENTER_VERIFICATION'
                : 'FINAL_COMPLETED',
            message:
              action === 'revision'
                ? `[Perlu Revisi · Final Financial Report] "${finHubItem.title}" dikembalikan oleh ${currentUser.name}: "${notes || 'Mohon perbaiki sesuai catatan'}".`
                : stage === 'finance'
                ? `[Final Financial Report] "${finHubItem.title}" telah diverifikasi oleh Finance (${currentUser.name}) dan menunggu Persetujuan Akhir Direktur.`
                : `[Disetujui Akhir · Final Financial Report] "${finHubItem.title}" telah disetujui penuh oleh Direktur (${currentUser.name}).`,
            targetUserIds:
              action === 'revision'
                ? reqTargets
                : stage === 'finance'
                ? Array.from(new Set([...directorIds, ...reqTargets]))
                : reqTargets,
            targetRoleCodes:
              action === 'revision'
                ? ['R']
                : stage === 'finance'
                ? ['Direktur', 'R']
                : ['R', 'A2'],
            createdAt: nowIso,
            isReadByUserIds: [],
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
        const pct = found.totalAmount > 0 ? Math.round((computedRealized / found.totalAmount) * 100) : 0;

        const stageLabel = stage === 'finance' ? 'Pemeriksaan Finance' : 'Persetujuan Director';
        draft.cashAdvanceAuditLogs[found.torId].unshift({
          id: `audit-rep-app-${Date.now()}`,
          torId: found.torId,
          timestamp: nowIso,
          actorId: currentUser.id,
          actorName: stage === 'finance' ? (found.reportVerifiedByName || currentUser.name) : (found.reportApprovedByName || currentUser.name),
          actorRole: stage === 'finance' ? 'Finance & Compliance' : 'Executive Director',
          action: `${stageLabel} — Tutup Laporan (${found.advanceNumber})`,
          details: `${stageLabel} telah memproses laporan ${found.advanceNumber}. Status: ${found.reportApprovalStatus}.`,
          totalAdvance: found.totalAmount,
          totalSpent: computedRealized,
          totalRemaining: remaining,
          totalShortage: shortage,
          percentUsed: pct,
          itemCount: (found.items || []).length,
        });
      });
    } catch (err: any) {
      return res.status(400).json({ error: err.message || 'Gagal memproses persetujuan laporan.' });
    }

    if (!updatedRecord) {
      return res.status(404).json({ error: 'Cash Advance tidak ditemukan' });
    }
    res.json(updatedRecord);
  });

  // Update existing cash advance
  app.put('/api/cash-advances/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);
    const body = req.body;

    let updatedRecord: CashAdvanceRecord | null = null;
    try {
      db.update((draft) => {
        if (!draft.cashAdvances) return;
        const index = draft.cashAdvances.findIndex((c) => c.id === id);
        if (index === -1) return;

        const existing = draft.cashAdvances[index];
        // Perlindungan terhadap perubahan data rincian setelah persetujuan akhir (kecuali Direktur/Finance atau dalam Draft/Perlu Perbaikan)
        if (
          (existing.status === 'Disetujui' || existing.status === 'Dicairkan') &&
          currentUser.role !== 'director' &&
          currentUser.role !== 'finance'
        ) {
          throw new Error(
            `Cash Advance ${existing.advanceNumber} telah berstatus '${existing.status}' dan rincian pengajuannya tidak dapat diubah lagi.`
          );
        }

        const recordToSave: CashAdvanceRecord = {
          ...existing,
          ...body,
          id: existing.id,
          advanceNumber: existing.advanceNumber,
          updatedAt: new Date().toISOString(),
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
          action: 'Pembaruan Cash Advance',
          entityType: 'TOR',
          entityId: existing.torId,
          details: `Formulir kasbon ${existing.advanceNumber} diperbarui. Total: ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(recordToSave.totalAmount)}`,
          timestamp: new Date().toISOString(),
        });
      });
    } catch (err: any) {
      return res.status(400).json({ error: err.message || 'Gagal memperbarui Cash Advance.' });
    }

    if (!updatedRecord) {
      return res.status(404).json({ error: 'Cash Advance tidak ditemukan' });
    }
    res.json(updatedRecord);
  });

  // Submit cash advance to finance (A2)
  app.post('/api/cash-advances/:id/submit', (req: Request, res: Response) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);
    const now = new Date();
    const nowIso = now.toISOString();

    let record: CashAdvanceRecord | null = null;
    try {
      db.update((draft) => {
        if (!draft.cashAdvances) return;
        const found = draft.cashAdvances.find((c) => c.id === id);
        if (!found) return;

        if (found.status !== 'Draft' && found.status !== 'Perlu Perbaikan') {
          throw new Error(
            `Cash Advance berstatus '${found.status}' sudah diajukan atau diproses (pencegahan double submission).`
          );
        }

        const wasRevision = found.status === 'Perlu Perbaikan';
        found.status = 'Diajukan';
        found.signatures.requestedBy = {
          name: currentUser.name,
          roleTitle: currentUser.roleTitle,
          date: nowIso.slice(0, 10),
          status: 'Diajukan',
          signatureNote: req.body.note || 'Telah diajukan secara resmi untuk ditinjau bagian Keuangan.',
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
            actorRoleCode: 'R',
            actorRoleTitle: currentUser.roleTitle || 'PIC Kegiatan',
            responsibleName: found.requesterName,
            actionLabel: wasRevision
              ? `Mengajukan Ulang Cash Advance (Revisi v${hubItem.version}) ke Finance (A2)`
              : 'Mengajukan Cash Advance ke Finance (A2)',
            resultingStatus: 'Pending Verification',
            comment:
              found.signatures.requestedBy?.signatureNote ||
              'Cash Advance diajukan ke Finance (A2) untuk verifikasi.',
            version: hubItem.version || 1,
          });

          if (!draft.approvalNotifications) draft.approvalNotifications = [];
          const a2Targets = [hubItem.accountableFinanceUserId].filter(
            (uid): uid is string => Boolean(uid)
          );
          draft.approvalNotifications.unshift({
            id: `notif-ca-sub-${Date.now()}`,
            approvalItemId: hubItem.id,
            referenceNumber: found.advanceNumber,
            documentTitle: `Cash Advance: ${found.activityTitle}`,
            categoryCode: 'cash_advance',
            categoryLabel: 'Cash Advance Request',
            eventType: 'NEW_SUBMISSION',
            message: `[Cash Advance Request] "${found.activityTitle}" (${found.advanceNumber}) telah ${wasRevision ? 'diajukan ulang' : 'diajukan'} oleh ${currentUser.name} dan menunggu verifikasi Finance (A2: ${hubItem.accountableFinanceUserName || 'Finance'}).`,
            targetUserIds: a2Targets,
            targetRoleCodes: ['A2'],
            createdAt: nowIso,
            isReadByUserIds: [],
          });
        }

        draft.auditLogs.unshift({
          id: `log-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: wasRevision ? 'Pengajuan Ulang Kasbon ke Finance' : 'Pengajuan Kasbon ke Finance',
          entityType: 'TOR',
          entityId: found.torId,
          details: `Cash Advance ${found.advanceNumber} diajukan ke Keuangan (A2) untuk verifikasi plafon.`,
          timestamp: nowIso,
        });
      });
    } catch (err: any) {
      return res.status(400).json({ error: err.message || 'Gagal mengajukan Cash Advance.' });
    }

    if (!record) return res.status(404).json({ error: 'Cash Advance tidak ditemukan' });
    res.json(record);
  });

  // Finance verifikasi
  app.post('/api/cash-advances/:id/verify', (req: Request, res: Response) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== 'finance' && currentUser.role !== 'admin') {
      return res.status(403).json({
        error: 'Akses ditolak: Hanya Finance (A2) yang berwenang memverifikasi pengajuan Cash Advance.',
      });
    }
    const { action, notes } = req.body; // action: 'verify' | 'revision' | 'reject'
    const now = new Date();
    const nowIso = now.toISOString();

    let record: CashAdvanceRecord | null = null;
    let errMsg: string | null = null;
    db.update((draft) => {
      if (!draft.cashAdvances) return;
      const found = draft.cashAdvances.find((c) => c.id === id);
      if (!found) return;

      if (found.requesterId === currentUser.id && currentUser.role !== 'director') {
        errMsg = 'Pemohon Cash Advance tidak diperbolehkan memverifikasi pengajuannya sendiri.';
        return;
      }

      if (action === 'verify') {
        found.status = 'Diverifikasi Finance';
        found.signatures.verifiedBy = {
          name: currentUser.name,
          roleTitle: currentUser.roleTitle || 'Finance Specialist',
          date: nowIso.slice(0, 10),
          status: 'Terverifikasi',
          notes: notes || 'Pagu anggaran, rincian biaya, dan kelengkapan administrasi telah diverifikasi valid.',
        };
      } else if (action === 'revision') {
        found.status = 'Perlu Perbaikan';
        found.signatures.verifiedBy = {
          name: currentUser.name,
          roleTitle: currentUser.roleTitle || 'Finance Specialist',
          date: nowIso.slice(0, 10),
          status: 'Perlu Perbaikan',
          notes: notes || 'Perlu penyesuaian rincian item kasbon.',
        };
      } else {
        found.status = 'Ditolak';
        found.signatures.verifiedBy = {
          name: currentUser.name,
          roleTitle: currentUser.roleTitle || 'Finance Specialist',
          date: nowIso.slice(0, 10),
          status: 'Ditolak',
          notes: notes || 'Pengajuan ditolak oleh Finance.',
        };
      }

      found.updatedAt = nowIso;
      record = found;
      syncTorBudgetInDraft(draft, found.torId);
      syncApprovalHubData(draft);

      const hubItem = draft.approvalHubItems?.[`apv-ca-${found.id}`];
      const parentTor = (draft.tors || []).find((t) => t.id === found.torId);
      const directorIds = (draft.users || [])
        .filter((u) => u.role === 'director')
        .map((u) => u.id);
      const reqTargets: string[] = Array.from(
        new Set(
          [found.requesterId, parentTor?.picId, parentTor?.createdById].filter(
            (id): id is string => Boolean(id)
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
          actorRoleCode: 'A2',
          actorRoleTitle: currentUser.roleTitle || 'Finance Specialist',
          responsibleName: found.requesterName,
          actionLabel:
            action === 'verify'
              ? 'Memverifikasi Cash Advance (Tahap A2)'
              : action === 'revision'
              ? 'Mengembalikan Cash Advance untuk Perbaikan (A2)'
              : 'Menolak Pengajuan Cash Advance (A2)',
          resultingStatus: hubItem.status,
          comment:
            found.signatures.verifiedBy?.notes ||
            'Verifikasi Cash Advance oleh Finance.',
          version: hubItem.version || 1,
        });
      }

      if (!draft.approvalNotifications) draft.approvalNotifications = [];
      draft.approvalNotifications.unshift({
        id: `notif-ca-ver-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        approvalItemId: `apv-ca-${found.id}`,
        referenceNumber: found.advanceNumber,
        documentTitle: `Cash Advance: ${found.activityTitle}`,
        categoryCode: 'cash_advance',
        categoryLabel: 'Cash Advance Request',
        eventType:
          action === 'verify'
            ? 'ENTER_VERIFICATION'
            : action === 'revision'
            ? 'REVISION_REQUIRED'
            : 'REJECTED',
        message:
          action === 'verify'
            ? `[Cash Advance Request] "${found.activityTitle}" (${found.advanceNumber}) telah diverifikasi oleh Finance (${currentUser.name}) dan menunggu Persetujuan Akhir Direktur.`
            : action === 'revision'
            ? `[Cash Advance Request] "${found.activityTitle}" (${found.advanceNumber}) dikembalikan untuk perbaikan oleh Finance (${currentUser.name}): "${found.signatures.verifiedBy?.notes || ''}"`
            : `[Cash Advance Request] "${found.activityTitle}" (${found.advanceNumber}) ditolak oleh Finance (${currentUser.name}): "${found.signatures.verifiedBy?.notes || ''}"`,
        targetUserIds:
          action === 'verify'
            ? Array.from(new Set([...directorIds, ...reqTargets]))
            : reqTargets,
        targetRoleCodes: action === 'verify' ? ['Direktur', 'R'] : ['R'],
        createdAt: nowIso,
        isReadByUserIds: [],
      });

      draft.auditLogs.unshift({
        id: `log-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: `Verifikasi Kasbon: ${action}`,
        entityType: 'TOR',
        entityId: found.torId,
        details: `Finance ${action === 'verify' ? 'menyetujui verifikasi' : action} pada kasbon ${found.advanceNumber}. Catatan: ${notes || '-'}`,
        timestamp: nowIso,
      });
    });

    if (errMsg) return res.status(403).json({ error: errMsg });
    if (!record) return res.status(404).json({ error: 'Cash Advance tidak ditemukan' });
    res.json(record);
  });

  // Director approve
  app.post('/api/cash-advances/:id/approve', (req: Request, res: Response) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== 'director') {
      return res.status(403).json({
        error: 'Akses ditolak: Hanya Executive Director yang berwenang memberikan persetujuan akhir Cash Advance.',
      });
    }
    const { action, notes } = req.body; // 'approve' | 'reject'
    const now = new Date();
    const nowIso = now.toISOString();

    let record: CashAdvanceRecord | null = null;
    db.update((draft) => {
      if (!draft.cashAdvances) return;
      const found = draft.cashAdvances.find((c) => c.id === id);
      if (!found) return;

      if (action === 'approve') {
        found.status = 'Disetujui';
        found.signatures.approvedBy = {
          name: currentUser.name,
          roleTitle: currentUser.roleTitle || 'Director',
          date: nowIso.slice(0, 10),
          status: 'Disetujui',
          notes: notes || 'Otorisasi pencairan dana operasional telah disetujui Direktur.',
        };
      } else {
        found.status = 'Ditolak';
        found.signatures.approvedBy = {
          name: currentUser.name,
          roleTitle: currentUser.roleTitle || 'Director',
          date: nowIso.slice(0, 10),
          status: 'Ditolak',
          notes: notes || 'Ditolak oleh Direktur.',
        };
      }

      found.updatedAt = nowIso;
      record = found;
      syncTorBudgetInDraft(draft, found.torId);
      syncApprovalHubData(draft);

      const hubItem = draft.approvalHubItems?.[`apv-ca-${found.id}`];
      const parentTor = (draft.tors || []).find((t) => t.id === found.torId);
      const financeUserIds = (draft.users || [])
        .filter(
          (u) =>
            u.role === 'finance' ||
            (u.roleTitle || '').toLowerCase().includes('finance') ||
            (u.roleTitle || '').toLowerCase().includes('kasir')
        )
        .map((u) => u.id);
      const reqTargets: string[] = Array.from(
        new Set(
          [found.requesterId, parentTor?.picId, parentTor?.createdById].filter(
            (id): id is string => Boolean(id)
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
          actorRoleCode: 'Direktur',
          actorRoleTitle: currentUser.roleTitle || 'Executive Director',
          responsibleName: found.requesterName,
          actionLabel:
            action === 'approve'
              ? 'Menyetujui Akhir Cash Advance (Direktur) — Siap Dicairkan Finance'
              : 'Menolak Pengajuan Cash Advance (Direktur)',
          resultingStatus: hubItem.status,
          comment:
            found.signatures.approvedBy?.notes ||
            (action === 'approve'
              ? 'Disetujui oleh Direktur. Menunggu pencairan dana oleh Finance ke rekening pengaju.'
              : 'Ditolak oleh Direktur.'),
          version: hubItem.version || 1,
        });
      }

      if (!draft.approvalNotifications) draft.approvalNotifications = [];
      const formattedAmt = new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0,
      }).format(found.totalAmount);

      draft.approvalNotifications.unshift({
        id: `notif-ca-dir-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        approvalItemId: `apv-ca-${found.id}`,
        referenceNumber: found.advanceNumber,
        documentTitle: `Cash Advance: ${found.activityTitle}`,
        categoryCode: 'cash_advance',
        categoryLabel: 'Cash Advance Request',
        eventType: action === 'approve' ? 'FINAL_COMPLETED' : 'REJECTED',
        message:
          action === 'approve'
            ? `[Disetujui Direktur · Siap Dicairkan Finance] Cash Advance "${found.activityTitle}" (${found.advanceNumber}) sebesar ${formattedAmt} telah disetujui oleh Direktur (${currentUser.name}). Selanjutnya Finance akan mencairkan dana ke rekening pengaju (${found.requesterName} — ${found.bankName} ${found.bankAccountNumber}).`
            : `[Cash Advance Request] "${found.activityTitle}" (${found.advanceNumber}) ditolak oleh Direktur (${currentUser.name}): "${found.signatures.approvedBy?.notes || ''}"`,
        targetUserIds:
          action === 'approve'
            ? Array.from(new Set([...reqTargets, ...financeUserIds]))
            : reqTargets,
        targetRoleCodes: action === 'approve' ? ['R', 'A2'] : ['R'],
        createdAt: nowIso,
        isReadByUserIds: [],
      });

      draft.auditLogs.unshift({
        id: `log-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: `Persetujuan Direktur Kasbon: ${action}`,
        entityType: 'TOR',
        entityId: found.torId,
        details: `Direktur ${action === 'approve' ? 'menyetujui' : 'menolak'} otorisasi kasbon ${found.advanceNumber}.`,
        timestamp: nowIso,
      });
    });

    if (!record) return res.status(404).json({ error: 'Cash Advance tidak ditemukan' });
    res.json(record);
  });

  // Disburse cash advance (Pencairan kasir/finance)
  app.post('/api/cash-advances/:id/disburse', (req: Request, res: Response) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== 'finance' && currentUser.role !== 'admin') {
      return res.status(403).json({
        error: 'Akses ditolak: Hanya Finance yang berwenang mencairkan dana Cash Advance.',
      });
    }
    const { transferReference, bankSource } = req.body;
    const now = new Date();
    const nowIso = now.toISOString();

    let record: CashAdvanceRecord | null = null;
    let errMsg: string | null = null;
    db.update((draft) => {
      if (!draft.cashAdvances) return;
      const found = draft.cashAdvances.find((c) => c.id === id);
      if (!found) return;
      if (found.status !== 'Disetujui' && found.status !== 'Dicairkan') {
        errMsg = `Cash Advance harus berstatus 'Disetujui' oleh Direktur sebelum dapat dicairkan oleh Finance (status saat ini: ${found.status}).`;
        return;
      }

      found.status = 'Dicairkan';
      found.signatures.disbursedBy = {
        name: currentUser.name,
        date: nowIso.slice(0, 10),
        transferReference: transferReference || `TRF-WIJNA-${Date.now().toString().slice(-6)}`,
        bankSource: bankSource || 'Bank Mandiri Operasional Yayasan',
        isDisbursed: true,
      };

      found.updatedAt = nowIso;
      record = found;
      syncTorBudgetInDraft(draft, found.torId);
      syncApprovalHubData(draft);

      const hubItem = draft.approvalHubItems?.[`apv-ca-${found.id}`];
      const parentTor = (draft.tors || []).find((t) => t.id === found.torId);
      const reqTargets: string[] = Array.from(
        new Set(
          [
            found.requesterId,
            parentTor?.picId,
            parentTor?.createdById,
            hubItem?.responsibleUserId,
          ].filter((id): id is string => Boolean(id))
        )
      );
      const formattedAmt = new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0,
      }).format(found.totalAmount);

      if (hubItem) {
        hubItem.previewData = {
          ...hubItem.previewData,
          isDisbursed: true,
          disbursedByName: found.signatures.disbursedBy.name,
          disbursedAt: found.signatures.disbursedBy.date,
          transferReference: found.signatures.disbursedBy.transferReference,
          bankSource: found.signatures.disbursedBy.bankSource,
        };
        hubItem.updatedAt = nowIso;
        hubItem.timeline = hubItem.timeline || [];
        hubItem.timeline.unshift({
          id: `tl-ca-disb-${found.id}-${Date.now()}`,
          timestamp: nowIso,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRoleCode: 'A2',
          actorRoleTitle: currentUser.roleTitle || 'Kasir / Finance Officer',
          responsibleName: found.requesterName,
          actionLabel: 'Mencairkan Dana Cash Advance ke Pengaju (Finance)',
          resultingStatus: 'Approved',
          comment: `Dana sebesar ${formattedAmt} telah dicairkan oleh ${currentUser.name} ke rekening pengaju ${found.bankName} (${found.bankAccountNumber} a.n. ${found.bankAccountHolder}). Ref Transfer: ${found.signatures.disbursedBy.transferReference} (${found.signatures.disbursedBy.bankSource}).`,
          version: hubItem.version || 1,
        });
      }

      if (!draft.approvalNotifications) draft.approvalNotifications = [];
      draft.approvalNotifications.unshift({
        id: `notif-ca-disb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        approvalItemId: `apv-ca-${found.id}`,
        referenceNumber: found.advanceNumber,
        documentTitle: `Cash Advance: ${found.activityTitle}`,
        categoryCode: 'cash_advance',
        categoryLabel: 'Cash Advance Request',
        eventType: 'FINAL_COMPLETED',
        message: `[Dana Telah Dicairkan · Cash Advance] Dana sebesar ${formattedAmt} untuk "${found.activityTitle}" (${found.advanceNumber}) telah dicairkan oleh Finance (${currentUser.name}) ke rekening pengaju (${found.bankName} · ${found.bankAccountNumber} a.n. ${found.bankAccountHolder}). Ref Transfer: ${found.signatures.disbursedBy.transferReference}.`,
        targetUserIds: reqTargets,
        targetRoleCodes: ['R'],
        createdAt: nowIso,
        isReadByUserIds: [],
      });

      draft.auditLogs.unshift({
        id: `log-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: 'Pencairan Kasbon (Disbursement)',
        entityType: 'TOR',
        entityId: found.torId,
        details: `Dana kasbon ${found.advanceNumber} sebesar ${formattedAmt} telah ditransfer kepada pengaju (${found.requesterName}). Ref: ${found.signatures.disbursedBy.transferReference}`,
        timestamp: nowIso,
      });
    });

    if (errMsg) return res.status(400).json({ error: errMsg });
    if (!record) return res.status(404).json({ error: 'Cash Advance tidak ditemukan' });
    res.json(record);
  });

  // Delete cash advance (only allowed for Draft and authorized owner/Finance/Director)
  app.delete('/api/cash-advances/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);

    let deleted = false;
    let errMsg: string | null = null;
    db.update((draft) => {
      if (!draft.cashAdvances) return;
      const idx = draft.cashAdvances.findIndex((c) => c.id === id);
      if (idx !== -1) {
        const item = draft.cashAdvances[idx];
        if (item.status !== 'Draft' && currentUser.role !== 'director') {
          errMsg = `Cash Advance berstatus '${item.status}' tidak dapat dihapus (hanya draf yang dapat dihapus).`;
          return;
        }
        if (
          item.requesterId !== currentUser.id &&
          currentUser.role !== 'finance' &&
          currentUser.role !== 'director'
        ) {
          errMsg = 'Hanya pembuat pengajuan, Finance, atau Direktur yang dapat menghapus draf Cash Advance.';
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
          action: 'Penghapusan Draf Kasbon',
          entityType: 'TOR',
          entityId: item.torId,
          details: `Draf kasbon ${item.advanceNumber} telah dihapus.`,
          timestamp: new Date().toISOString(),
        });
      }
    });

    if (errMsg) return res.status(403).json({ error: errMsg });
    if (!deleted) return res.status(404).json({ error: 'Cash Advance tidak ditemukan' });
    res.json({ message: 'Draf Cash Advance berhasil dihapus' });
  });

  // Stats calculation (Synchronized with ApprovalHub & RACI Access)
  app.get('/api/stats', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    db.update((draft) => {
      syncApprovalHubData(draft);
    });
    const data = db.getData();
    let tors = [...data.tors];

    if (currentUser.role === 'staff' && !currentUser.permissions.canViewAllTors) {
      tors = tors.filter((t) => t.picId === currentUser.id || t.createdById === currentUser.id);
    }

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const todayMs = new Date(todayStr).getTime();

    let activeTors = 0;
    let nearDeadline = 0;
    let overdue = 0;

    tors.forEach((t) => {
      if (t.activityStatus === 'Sedang Berjalan' || t.submissionStatus === 'Disetujui') {
        activeTors++;
      }

      if (t.reportingDeadline) {
        const deadMs = new Date(t.reportingDeadline).getTime();
        const diffDays = Math.ceil((deadMs - todayMs) / (1000 * 60 * 60 * 24));

        if (diffDays < 0 && t.activityStatus !== 'Selesai') {
          overdue++;
        } else if (diffDays >= 0 && diffDays <= 3 && t.activityStatus !== 'Selesai') {
          nearDeadline++;
        }
      }
    });

    // Calculate pendingApprovals synchronized with user's ApprovalHub queue
    const allItems = Object.values(data.approvalHubItems || {});
    const access = resolveUserApprovalAccess(data, currentUser, allItems);
    const visibleItems = filterApprovalItemsForUser(allItems, currentUser, access);
    const pendingApprovals = visibleItems.filter((item) => {
      if (access.isDirector && item.previewData?.editRequestStatus === 'pending') return true;
      if (
        item.groupType === 'program_documents' &&
        access.isA1 &&
        item.accountableProgramUserId === currentUser.id &&
        item.status === 'Pending Verification'
      ) {
        return true;
      }
      if (
        item.groupType === 'financial_documents' &&
        access.isA2 &&
        item.accountableFinanceUserId === currentUser.id &&
        item.status === 'Pending Verification'
      ) {
        return true;
      }
      if (access.isDirector && item.status === 'Pending Approval') return true;
      return false;
    }).length;

    res.json({
      activeTors,
      pendingApprovals,
      nearDeadline,
      overdue,
    });
  });

  // Audit Logs (Role-based confidentiality: Management & Audit roles view all; Staff view own activity)
  app.get('/api/audit-logs', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const data = db.getData();
    const canViewGlobalAudit =
      currentUser.role === 'admin' ||
      currentUser.role === 'director' ||
      currentUser.role === 'finance' ||
      currentUser.role === 'program_manager' ||
      currentUser.role === 'meal' ||
      Boolean(currentUser.permissions?.canViewAllTors);
    if (!canViewGlobalAudit) {
      return res.json((data.auditLogs || []).filter((log) => log.actorId === currentUser.id));
    }
    res.json(data.auditLogs);
  });

  // Cash Advance Summary & Dedicated Audit Trail
  app.get('/api/cash-advance-summaries/:torId', (req: Request, res: Response) => {
    const { torId } = req.params;
    const data = db.getData();
    const summary = data.cashAdvanceSummaries?.[torId] || null;
    const auditLogs = data.cashAdvanceAuditLogs?.[torId] || [];
    res.json({ summary, auditLogs });
  });

  app.post('/api/cash-advance-summaries/:torId', (req: Request, res: Response) => {
    const { torId } = req.params;
    const { summaryRows, reportDate, note, actionType } = req.body;
    const currentUser = getCurrentUser(req);
    const now = new Date();

    const totalAdvance = (summaryRows || []).reduce((acc: number, r: any) => acc + (Number(r.advanceAmount) || 0), 0);
    const totalSpent = (summaryRows || []).reduce((acc: number, r: any) => acc + (Number(r.actualSpent) || 0), 0);
    const totalRemaining = (summaryRows || []).reduce(
      (acc: number, r: any) => acc + Math.max(0, (Number(r.advanceAmount) || 0) - (Number(r.actualSpent) || 0)),
      0
    );
    const totalShortage = (summaryRows || []).reduce(
      (acc: number, r: any) => acc + Math.max(0, (Number(r.actualSpent) || 0) - (Number(r.advanceAmount) || 0)),
      0
    );
    const percentUsed = totalAdvance > 0 ? Math.round((totalSpent / totalAdvance) * 100) : 0;

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
      updatedByRole: currentUser.role,
    };

    const auditEntry = {
      id: `audit-sum-${Date.now()}`,
      torId,
      timestamp: now.toISOString(),
      actorId: currentUser.id,
      actorName: currentUser.name,
      actorRole: currentUser.role,
      action: actionType || 'Pembaruan Ringkasan Realisasi Belanja',
      details: note || `Pembaruan realisasi belanja Cash Advance: Total Uang Muka Rp ${totalAdvance.toLocaleString('id-ID')}, Realisasi Belanja Rp ${totalSpent.toLocaleString('id-ID')}, Akumulasi Sisa Rp ${totalRemaining.toLocaleString('id-ID')}, Akumulasi Kekurangan Rp ${totalShortage.toLocaleString('id-ID')} (${percentUsed}%).`,
      totalAdvance,
      totalSpent,
      totalRemaining,
      totalShortage,
      percentUsed,
      itemCount: (summaryRows || []).length,
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

      // Also register to global organization audit trail
      draft.auditLogs.unshift({
        id: `log-ca-sum-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.role,
        action: 'Pembaruan Ringkasan Realisasi Cash Advance',
        entityType: 'TOR',
        entityId: torId,
        details: auditEntry.details,
        timestamp: now.toISOString(),
      });
    });

    res.json({
      success: true,
      message: 'Ringkasan Cash Advance berhasil diperbarui dan dicatat ke Audit Trail terpisah.',
      summary: summaryRecord,
      auditLog: auditEntry,
      auditLogs: db.getData().cashAdvanceAuditLogs?.[torId] || [],
    });
  });

  // Sequential Approval for RINGKASAN AKHIR (Pemohon -> Finance -> Director)
  app.post('/api/cash-advance-summaries/:torId/approve', (req: Request, res: Response) => {
    const { torId } = req.params;
    const { stage, notes } = req.body; // stage: 'report' | 'finance' | 'director'
    const currentUser = getCurrentUser(req);
    const now = new Date();

    let updatedSummary: any = null;
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
        percentUsed: 0,
      };

      const targetTor = (draft.tors || []).find((t) => t.id === torId);
      const defaultReporter = targetTor?.picName || targetTor?.createdByName || currentUser.name;

      if (stage === 'finance' && currentUser.role !== 'finance' && currentUser.role !== 'admin') {
        return;
      }
      if (stage === 'director' && currentUser.role !== 'director' && currentUser.role !== 'admin') {
        return;
      }

      if (stage === 'report') {
        existing.summaryApprovalStatus = 'Menunggu Pemeriksaan Finance';
        existing.summaryReportedByName = defaultReporter;
        existing.summaryReportedAt = now.toISOString();
        // Ensure all active CAs for this TOR are marked reported if closing final financial report
        (draft.cashAdvances || []).forEach((ca) => {
          if (ca.torId === torId && ca.status !== 'Ditolak') {
            ca.isReported = true;
            ca.reportedByName = ca.reportedByName || defaultReporter;
            ca.reportedAt = ca.reportedAt || now.toISOString();
            if (!ca.reportApprovalStatus) {
              ca.reportApprovalStatus = 'Menunggu Pemeriksaan Finance';
            }
          }
        });
      } else if (stage === 'finance') {
        if (!existing.summaryReportedByName) {
          existing.summaryReportedByName = defaultReporter;
          existing.summaryReportedAt = now.toISOString();
        }
        existing.summaryApprovalStatus = 'Menunggu Persetujuan Director';
        existing.summaryVerifiedByName = currentUser.name;
        existing.summaryVerifiedAt = now.toISOString();
        (draft.cashAdvances || []).forEach((ca) => {
          if (ca.torId === torId && ca.status !== 'Ditolak' && ca.isReported) {
            ca.reportVerifiedByName = existing.summaryVerifiedByName;
            ca.reportVerifiedAt = ca.reportVerifiedAt || now.toISOString();
            if (ca.reportApprovalStatus !== 'Telah Disetujui') {
              ca.reportApprovalStatus = 'Menunggu Persetujuan Director';
            }
          }
        });
      } else if (stage === 'director') {
        if (!existing.summaryReportedByName) {
          existing.summaryReportedByName = defaultReporter;
          existing.summaryReportedAt = now.toISOString();
        }
        if (!existing.summaryVerifiedByName) {
          existing.summaryVerifiedByName = currentUser.name;
          existing.summaryVerifiedAt = now.toISOString();
        }
        existing.summaryApprovalStatus = 'Telah Disetujui';
        existing.summaryApprovedByName = currentUser.name;
        existing.summaryApprovedAt = now.toISOString();
        (draft.cashAdvances || []).forEach((ca) => {
          if (ca.torId === torId && ca.status !== 'Ditolak' && ca.isReported) {
            ca.reportVerifiedByName = ca.reportVerifiedByName || existing.summaryVerifiedByName;
            ca.reportVerifiedAt = ca.reportVerifiedAt || now.toISOString();
            ca.reportApprovedByName = existing.summaryApprovedByName;
            ca.reportApprovedAt = ca.reportApprovedAt || now.toISOString();
            ca.reportApprovalStatus = 'Telah Disetujui';
          }
        });
      }

      existing.updatedAt = now.toISOString();
      draft.cashAdvanceSummaries[torId] = existing;
      updatedSummary = existing;

      if (!draft.cashAdvanceAuditLogs) draft.cashAdvanceAuditLogs = {};
      if (!draft.cashAdvanceAuditLogs[torId]) draft.cashAdvanceAuditLogs[torId] = [];

      const labelMap: Record<string, string> = {
        report: 'Pelaporan Ringkasan Akhir oleh Pemohon',
        finance: 'Pemeriksaan & Persetujuan Finance pada Ringkasan Akhir',
        director: 'Persetujuan Akhir Director pada Ringkasan Akhir',
      };

      draft.cashAdvanceAuditLogs[torId].unshift({
        id: `audit-sum-app-${Date.now()}`,
        torId,
        timestamp: now.toISOString(),
        actorId: currentUser.id,
        actorName:
          stage === 'finance'
            ? existing.summaryVerifiedByName
            : stage === 'director'
            ? existing.summaryApprovedByName
            : existing.summaryReportedByName,
        actorRole:
          stage === 'finance'
            ? 'Finance & Compliance'
            : stage === 'director'
            ? 'Executive Director'
            : 'Pemohon / Pelaksana Kegiatan',
        action: labelMap[stage] || 'Persetujuan Ringkasan Akhir',
        details: notes || `Ringkasan Akhir telah diproses pada tahap ${labelMap[stage] || stage}. Status saat ini: ${existing.summaryApprovalStatus}.`,
        totalAdvance: existing.totalAdvance || 0,
        totalSpent: existing.totalSpent || 0,
        totalRemaining: existing.totalRemaining || 0,
        totalShortage: existing.totalShortage || 0,
        percentUsed: existing.percentUsed || 0,
        itemCount: (existing.summaryRows || []).length,
      });
    });

    res.json({
      success: true,
      summary: updatedSummary,
      auditLogs: db.getData().cashAdvanceAuditLogs?.[torId] || [],
    });
  });

  // --- MEETING MINUTES (MODUL 04: NOTULEN) APIS ---
  app.get('/api/meeting-minutes', (req: Request, res: Response) => {
    const data = db.getData();
    const list = [...(data.meetingMinutes || [])];
    const { torId } = req.query;

    const filtered = torId && typeof torId === 'string' && torId !== 'all'
      ? list.filter((m) => m.torId === torId)
      : list;

    filtered.sort((a, b) => (b.meetingDate || b.createdAt).localeCompare(a.meetingDate || a.createdAt));
    res.json(filtered);
  });

  app.post('/api/meeting-minutes', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const now = new Date();
    const body = req.body || {};

    let createdRecord: MeetingMinutesRecord | null = null;

    db.update((draft) => {
      if (!draft.meetingMinutes) draft.meetingMinutes = [];
      const torMinutesCount = body.torId
        ? draft.meetingMinutes.filter((m) => m.torId === body.torId).length
        : draft.meetingMinutes.length;
      const seqNum = torMinutesCount + 1;
      const seqStr = String(seqNum).padStart(3, '0');
      const dateStr = body.meetingDate || now.toISOString().slice(0, 10);
      const parsedDate = new Date(dateStr);
      const monthIdx = !isNaN(parsedDate.getTime()) ? parsedDate.getMonth() : now.getMonth();
      const yearNum = !isNaN(parsedDate.getTime()) ? parsedDate.getFullYear() : now.getFullYear();
      const romanMonths = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
      const romanMonth = romanMonths[monthIdx] || 'X';
      const linkedTor = body.torId ? (draft.tors || []).find((t) => t.id === body.torId) : null;
      const notulenTitle = (body.title || '').trim() || linkedTor?.title || 'Notulen Rapat';

      const autoDocNumber =
        body.documentNumber && String(body.documentNumber).trim()
          ? String(body.documentNumber).trim()
          : `${seqStr}/MOM/WIJNA/${romanMonth}/${yearNum}`;

      const newMom: MeetingMinutesRecord = {
        id: `mom-${Date.now()}`,
        documentNumber: autoDocNumber,
        torId: body.torId || undefined,
        torNumber: body.torNumber || linkedTor?.torNumber || undefined,
        title: notulenTitle,
        implementationProject: body.implementationProject || '',
        partnerOrganization: body.partnerOrganization || '',
        meetingDate: dateStr,
        startTime: body.startTime || '09:00',
        endTime: body.endTime || '11:00',
        meetingLocation: body.meetingLocation || '',
        meetingRoomPlatform: body.meetingRoomPlatform || '',
        participants: Array.isArray(body.participants) ? body.participants : [],
        recorderName: body.recorderName ?? '',
        discussions: Array.isArray(body.discussions) ? body.discussions : [],
        decisions: Array.isArray(body.decisions) ? body.decisions : [],
        actionPoints: Array.isArray(body.actionPoints) ? body.actionPoints : [],
        additionalNotes: body.additionalNotes || '',
        nextMeetingAgenda: body.nextMeetingAgenda || '',
        nextMeetingSchedule: body.nextMeetingSchedule || '',
        preparationDocuments: body.preparationDocuments || '',
        partnerInstitution: body.partnerInstitution || '',
        partnerRepName: body.partnerRepName || '',
        partnerRepTitle: body.partnerRepTitle || '',
        createdById: currentUser.id,
        createdByName: currentUser.name,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };

      draft.meetingMinutes.unshift(newMom);
      createdRecord = newMom;

      draft.auditLogs.unshift({
        id: `log-mom-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.role,
        action: 'Pembuatan Notulen Rapat',
        entityType: 'TOR',
        entityId: newMom.torId || newMom.id,
        details: `Membuat dokumen notulen ${newMom.documentNumber} — "${newMom.title}"`,
        timestamp: now.toISOString(),
      });
    });

    res.status(201).json(createdRecord);
  });

  app.put('/api/meeting-minutes/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);
    const now = new Date();
    const body = req.body || {};

    let updatedRecord: MeetingMinutesRecord | null = null;

    db.update((draft) => {
      if (!draft.meetingMinutes) draft.meetingMinutes = [];
      const idx = draft.meetingMinutes.findIndex((m) => m.id === id);
      if (idx === -1) return;

      const existing = draft.meetingMinutes[idx];
      const merged: MeetingMinutesRecord = {
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
        updatedAt: now.toISOString(),
      };

      draft.meetingMinutes[idx] = merged;
      updatedRecord = merged;

      draft.auditLogs.unshift({
        id: `log-mom-upd-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.role,
        action: 'Pembaruan Notulen Rapat',
        entityType: 'TOR',
        entityId: merged.torId || merged.id,
        details: `Memperbarui dokumen notulen ${merged.documentNumber} — "${merged.title}"`,
        timestamp: now.toISOString(),
      });
    });

    if (!updatedRecord) {
      return res.status(404).json({ error: 'Notulen tidak ditemukan' });
    }

    res.json(updatedRecord);
  });

  app.delete('/api/meeting-minutes/:id', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const data = db.getData();
    const target = (data.meetingMinutes || []).find((m) => m.id === id);
    if (!target) {
      return res.status(404).json({ error: 'Notulen tidak ditemukan' });
    }
    if (
      target.createdById &&
      target.createdById !== currentUser.id &&
      currentUser.role !== 'director' &&
      currentUser.role !== 'program_manager' &&
      currentUser.role !== 'meal' &&
      currentUser.role !== 'admin'
    ) {
      return res.status(403).json({
        error: 'Akses ditolak: Hanya pembuat notulen, Program Manager, MEAL, atau Direktur yang dapat menghapus notulen ini.',
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
        action: 'Penghapusan Notulen Rapat',
        entityType: 'TOR',
        entityId: target.torId || id,
        details: `Menghapus dokumen notulen ${target.documentNumber} — "${target.title}".`,
        timestamp: new Date().toISOString(),
      });
    });
    res.json({ message: 'Notulen berhasil dihapus' });
  });

  // --- ACTIVITY DOCUMENTATION (MODUL 05: DOCUMENTATION) APIS ---
  app.get('/api/documentation-list/:torId', (req: Request, res: Response) => {
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
          documentNumber: single.documentNumber || '001/DOC/WIJNA/X/2026',
        },
      ]);
    }

    return res.json([]);
  });

  app.post('/api/documentation-list/:torId', (req: Request, res: Response) => {
    const { torId } = req.params;
    const currentUser = getCurrentUser(req);
    const now = new Date();
    const nowIso = now.toISOString();
    const body = req.body || {};

    let savedRecord: ActivityDocumentationRecord | null = null;

    db.update((draft) => {
      if (!draft.activityDocumentations) draft.activityDocumentations = {};
      if (!Array.isArray(draft.activityDocumentationList)) draft.activityDocumentationList = [];

      const torIdx = draft.tors.findIndex((t) => t.id === torId);
      const tor = torIdx >= 0 ? draft.tors[torIdx] : undefined;

      const existingIdx = body.id
        ? draft.activityDocumentationList.findIndex((d) => d.id === body.id)
        : -1;
      const prev =
        existingIdx >= 0 ? draft.activityDocumentationList[existingIdx] : undefined;

      const romanMonths = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
      const romanMonth = romanMonths[now.getMonth()] || 'X';
      const yearNum = now.getFullYear();
      const seqNum = draft.activityDocumentationList.length + 1;
      const autoDocNumber =
        body.documentNumber && String(body.documentNumber).trim()
          ? String(body.documentNumber).trim()
          : prev?.documentNumber || `${String(seqNum).padStart(3, '0')}/DOC/WIJNA/${romanMonth}/${yearNum}`;

      const bestPhotos = [1, 2, 3, 4, 5].map((slotNum, idx) => {
        const incoming = Array.isArray(body.bestPhotos)
          ? body.bestPhotos.find((p: any) => Number(p.slotNumber) === slotNum) || body.bestPhotos[idx]
          : undefined;
        const fallback = prev?.bestPhotos?.[idx];
        return {
          slotNumber: slotNum,
          photoNameTitle: String(incoming?.photoNameTitle ?? fallback?.photoNameTitle ?? ''),
          photoLink: String(incoming?.photoLink ?? fallback?.photoLink ?? ''),
          photoLocation: String(
            incoming?.photoLocation ?? fallback?.photoLocation ?? tor?.location ?? ''
          ),
          photographer: String(incoming?.photographer ?? fallback?.photographer ?? ''),
        };
      });

      const rawStories = Array.isArray(body.humanInterestStories)
        ? body.humanInterestStories
        : prev?.humanInterestStories || [];
      const humanInterestStories = rawStories
        .map((s: any, idx: number) => ({
          id: s.id || `his-${Date.now()}-${idx + 1}`,
          storyTitle: String(s.storyTitle ?? ''),
          storyLink: String(s.storyLink ?? ''),
        }))
        .filter((s: any) => s.storyTitle.trim() !== '' || s.storyLink.trim() !== '');

      const rawGeneralLinks = Array.isArray(body.generalPhotoLinks)
        ? body.generalPhotoLinks
        : prev?.generalPhotoLinks || [];
      const generalPhotoLinks =
        rawGeneralLinks.length > 0
          ? rawGeneralLinks.map((g: any, idx: number) => ({
              id: g.id || `gpl-${Date.now()}-${idx + 1}`,
              url: String(g.url ?? ''),
            }))
          : [
              {
                id: `gpl-${Date.now()}-1`,
                url: '',
              },
            ];

      const nextDoc: ActivityDocumentationRecord = {
        id: prev?.id || body.id || `doc-act-${torId}-${Date.now()}`,
        documentNumber: autoDocNumber,
        torId,
        torNumber: body.torNumber || tor?.torNumber || prev?.torNumber || '',
        programId: body.programId || tor?.programId || prev?.programId || '',
        programName: body.programName || tor?.programName || prev?.programName || '',
        activityTitle: body.activityTitle || tor?.title || prev?.activityTitle || '',
        bestPhotosStoryTopic: String(
          body.bestPhotosStoryTopic ?? prev?.bestPhotosStoryTopic ?? ''
        ),
        bestPhotos,
        humanInterestStories,
        generalPhotoLinks,
        updatedById: currentUser.id,
        updatedByName: currentUser.name,
        createdAt: prev?.createdAt || nowIso,
        updatedAt: nowIso,
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
          updatedAt: nowIso,
        };
      }
      savedRecord = nextDoc;

      draft.auditLogs.unshift({
        id: `log-doc-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: existingIdx >= 0 ? 'Pembaruan Dokumentasi Kegiatan' : 'Pembuatan Dokumentasi Kegiatan',
        entityType: 'TOR',
        entityId: torId,
        details: `Menyimpan paket dokumentasi ${nextDoc.documentNumber} — Topik Cerita: "${nextDoc.bestPhotosStoryTopic || '-'}" untuk ${nextDoc.torNumber || torId}.`,
        timestamp: nowIso,
      });
    });

    res.json(savedRecord);
  });

  app.delete('/api/documentation-list/:id', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const data = db.getData();
    const target = (data.activityDocumentationList || []).find((d) => d.id === id);
    if (!target) {
      return res.status(404).json({ error: 'Dokumentasi kegiatan tidak ditemukan' });
    }
    if (
      target.updatedById &&
      target.updatedById !== currentUser.id &&
      currentUser.role !== 'director' &&
      currentUser.role !== 'program_manager' &&
      currentUser.role !== 'meal' &&
      currentUser.role !== 'admin'
    ) {
      return res.status(403).json({
        error: 'Akses ditolak: Hanya pembuat dokumentasi, Program Manager, MEAL, atau Direktur yang dapat menghapus paket dokumentasi ini.',
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
        action: 'Penghapusan Dokumentasi Kegiatan',
        entityType: 'TOR',
        entityId: target.torId || id,
        details: `Menghapus paket dokumentasi ${target.documentNumber} (${target.activityTitle || id}).`,
        timestamp: new Date().toISOString(),
      });
    });
    res.json({ message: 'Dokumentasi kegiatan berhasil dihapus' });
  });

  app.get('/api/documentations/:torId', (req: Request, res: Response) => {
    const { torId } = req.params;
    const data = db.getData();
    const tor = data.tors.find((t) => t.id === torId);
    const existing =
      (data.activityDocumentationList || []).find((d) => d.torId === torId) ||
      data.activityDocumentations?.[torId] ||
      tor?.documentation;

    if (existing) {
      return res.json(existing);
    }

    const defaultSlots = [1, 2, 3, 4, 5].map((slotNumber) => ({
      slotNumber,
      photoNameTitle: '',
      photoLink: '',
      photoLocation: tor?.location || '',
      photographer: '',
    }));

    const defaultDoc: ActivityDocumentationRecord = {
      id: `doc-act-${torId}`,
      documentNumber: '001/DOC/WIJNA/X/2026',
      torId,
      torNumber: tor?.torNumber || '',
      programId: tor?.programId || '',
      programName: tor?.programName || '',
      activityTitle: tor?.title || '',
      bestPhotosStoryTopic: '',
      bestPhotos: defaultSlots,
      humanInterestStories: [],
      generalPhotoLinks: [
        {
          id: `gpl-${Date.now()}-1`,
          url: '',
        },
      ],
      updatedById: data.currentUserId || 'user-staff-1',
      updatedByName: tor?.picName || 'Staff WIJNA',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    res.json(defaultDoc);
  });

  app.post('/api/documentations/:torId', (req: Request, res: Response) => {
    const { torId } = req.params;
    const currentUser = getCurrentUser(req);
    const now = new Date().toISOString();
    const body = req.body || {};

    let savedRecord: ActivityDocumentationRecord | null = null;

    db.update((draft) => {
      if (!draft.activityDocumentations) draft.activityDocumentations = {};
      if (!Array.isArray(draft.activityDocumentationList)) draft.activityDocumentationList = [];
      const torIdx = draft.tors.findIndex((t) => t.id === torId);
      const tor = torIdx >= 0 ? draft.tors[torIdx] : undefined;
      const prev = draft.activityDocumentations[torId] || tor?.documentation;

      const bestPhotos = [1, 2, 3, 4, 5].map((slotNum, idx) => {
        const incoming = Array.isArray(body.bestPhotos)
          ? body.bestPhotos.find((p: any) => Number(p.slotNumber) === slotNum) || body.bestPhotos[idx]
          : undefined;
        const fallback = prev?.bestPhotos?.[idx];
        return {
          slotNumber: slotNum,
          photoNameTitle: String(incoming?.photoNameTitle ?? fallback?.photoNameTitle ?? ''),
          photoLink: String(incoming?.photoLink ?? fallback?.photoLink ?? ''),
          photoLocation: String(incoming?.photoLocation ?? fallback?.photoLocation ?? tor?.location ?? ''),
          photographer: String(incoming?.photographer ?? fallback?.photographer ?? ''),
        };
      });

      const rawStories = Array.isArray(body.humanInterestStories)
        ? body.humanInterestStories
        : prev?.humanInterestStories || [];
      const humanInterestStories = rawStories
        .map((s: any, idx: number) => ({
          id: s.id || `his-${Date.now()}-${idx + 1}`,
          storyTitle: String(s.storyTitle ?? ''),
          storyLink: String(s.storyLink ?? ''),
        }))
        .filter((s: any) => s.storyTitle.trim() !== '' || s.storyLink.trim() !== '');

      const rawGeneralLinks = Array.isArray(body.generalPhotoLinks)
        ? body.generalPhotoLinks
        : prev?.generalPhotoLinks || [];
      const generalPhotoLinks =
        rawGeneralLinks.length > 0
          ? rawGeneralLinks.map((g: any, idx: number) => ({
              id: g.id || `gpl-${Date.now()}-${idx + 1}`,
              url: String(g.url ?? ''),
            }))
          : [
              {
                id: `gpl-${Date.now()}-1`,
                url: '',
              },
            ];

      const nextDoc: ActivityDocumentationRecord = {
        id: prev?.id || `doc-act-${torId}`,
        documentNumber: prev?.documentNumber || '001/DOC/WIJNA/X/2026',
        torId,
        torNumber: body.torNumber || tor?.torNumber || prev?.torNumber || '',
        programId: body.programId || tor?.programId || prev?.programId || '',
        programName: body.programName || tor?.programName || prev?.programName || '',
        activityTitle: body.activityTitle || tor?.title || prev?.activityTitle || '',
        bestPhotosStoryTopic: String(body.bestPhotosStoryTopic ?? prev?.bestPhotosStoryTopic ?? ''),
        bestPhotos,
        humanInterestStories,
        generalPhotoLinks,
        updatedById: currentUser.id,
        updatedByName: currentUser.name,
        createdAt: prev?.createdAt || now,
        updatedAt: now,
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
          updatedAt: now,
        };
      }
      savedRecord = nextDoc;
    });

    res.json(savedRecord);
  });

  // ============================================================================
  // MONITORING TOOLS – MEAL CONNECT (RACI PER OUTPUT & MONITORING TOOLS PER ACTIVITY)
  // ============================================================================
  app.get('/api/monitoring-connect', (_req: Request, res: Response) => {
    const data = db.getData();
    res.json({
      outputRaciRecords: data.outputRaciRecords || {},
      activityMonitoringRecords: data.activityMonitoringRecords || {},
    });
  });

  app.post('/api/monitoring-connect/raci/:outputId', (req: Request, res: Response) => {
    const { outputId } = req.params;
    const currentUser = getCurrentUser(req);
    if (currentUser.isActive === false) {
      return res.status(403).json({
        error: 'Akun Anda berstatus nonaktif dan tidak dapat mengubah penugasan RACI.',
      });
    }

    const canManageRaci =
      currentUser.role === 'program_manager' ||
      currentUser.role === 'admin' ||
      Boolean(currentUser.permissions?.canManagePrograms);

    if (!canManageRaci) {
      return res.status(403).json({
        error:
          'Hanya Program Manager atau pengguna dengan izin Kelola Struktur Program yang dapat mengatur penugasan RACI Output.',
      });
    }

    const body = req.body || {};
    const nowIso = new Date().toISOString();

    const checkData = db.getData();
    const checkResp = body.responsibleUserId
      ? checkData.users.find((u) => u.id === body.responsibleUserId)
      : undefined;
    const checkAcc = body.accountableUserId
      ? checkData.users.find((u) => u.id === body.accountableUserId)
      : undefined;

    if (body.responsibleUserId && !checkResp) {
      return res.status(400).json({ error: 'Pengguna R (Responsible) tidak ditemukan dalam database pengguna.' });
    }
    if (body.accountableUserId && !checkAcc) {
      return res.status(400).json({ error: 'Pengguna A1 (Accountable Program) tidak ditemukan dalam database pengguna.' });
    }
    if (checkResp && checkResp.isActive === false) {
      return res.status(400).json({
        error: `Pengguna "${checkResp.name}" berstatus Nonaktif dan tidak dapat ditugaskan sebagai R (Responsible) baru.`,
      });
    }
    if (checkAcc && checkAcc.isActive === false) {
      return res.status(400).json({
        error: `Pengguna "${checkAcc.name}" berstatus Nonaktif dan tidak dapat ditugaskan sebagai A1 (Accountable) baru.`,
      });
    }

    let savedRecord: OutputRaciRecord | null = null;

    db.update((draft) => {
      if (!draft.outputRaciRecords) draft.outputRaciRecords = {};
      const outp = draft.outputs.find((o) => o.id === outputId);
      const outc = draft.outcomes.find((oc) => oc.id === outp?.outcomeId);
      const prev = draft.outputRaciRecords[outputId];

      const respUser = draft.users.find((u) => u.id === body.responsibleUserId);
      const accUser = draft.users.find((u) => u.id === body.accountableUserId);
      const finUser =
        (body.accountableFinanceUserId
          ? draft.users.find((u) => u.id === body.accountableFinanceUserId && u.isActive !== false)
          : undefined) ||
        draft.users.find((u) => u.id === prev?.accountableFinanceUserId && u.isActive !== false) ||
        draft.users.find((u) => u.role === 'finance' && u.isActive !== false);

      const consultedUsers: string[] = Array.isArray(body.consultedUsers)
        ? Array.from(
            new Set(
              body.consultedUsers.map((c: any) => String(c || '').trim()).filter(Boolean)
            )
          )
        : prev?.consultedUsers || [];
      const informedUsers: string[] = Array.isArray(body.informedUsers)
        ? Array.from(
            new Set(
              body.informedUsers.map((i: any) => String(i || '').trim()).filter(Boolean)
            )
          )
        : prev?.informedUsers || [];

      const hasRA = Boolean(respUser && accUser);

      const isReassignment = Boolean(
        prev &&
          (prev.responsibleUserId !== (respUser?.id || '') ||
            prev.accountableUserId !== (accUser?.id || ''))
      );

      const prevHistory = Array.isArray(prev?.auditHistory) ? [...prev.auditHistory] : [];
      const newAuditEntry: NonNullable<OutputRaciRecord['auditHistory']>[number] = {
        id: `raci-aud-${Date.now()}`,
        timestamp: nowIso,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: isReassignment ? 'Pembaruan Penugasan RACI' : 'Penugasan RACI Diajukan',
        status: hasRA ? 'Menunggu Persetujuan Direktur' : 'Menunggu Program Manager',
        notes: `R: ${respUser?.name || '-'} · A1: ${accUser?.name || '-'}`,
        rName: respUser?.name || '-',
        a1Name: accUser?.name || '-',
      };

      const nextRecord: OutputRaciRecord = {
        outputId,
        programId: body.programId || outc?.programId || prev?.programId || '',
        outcomeId: body.outcomeId || outp?.outcomeId || prev?.outcomeId || '',
        responsibleUserId: respUser?.id || '',
        responsibleUserName: respUser?.name || '',
        accountableUserId: accUser?.id || '',
        accountableUserName: accUser?.name || '',
        accountableFinanceUserId: finUser?.id || prev?.accountableFinanceUserId,
        accountableFinanceUserName: finUser?.name || prev?.accountableFinanceUserName,
        consultedUsers,
        informedUsers,
        status: hasRA ? 'Menunggu Persetujuan Direktur' : 'Menunggu Program Manager',
        assignedById: currentUser.id,
        assignedByName: currentUser.name,
        assignedAt: nowIso,
        approvedById: undefined,
        approvedByName: undefined,
        approvedAt: undefined,
        directorNotes: undefined,
        auditHistory: [newAuditEntry, ...prevHistory],
        updatedAt: nowIso,
      };

      draft.outputRaciRecords[outputId] = nextRecord;
      savedRecord = nextRecord;

      // Sinkronkan PIC pada Output dengan R (Responsible) yang ditugaskan
      if (outp && respUser) {
        outp.picName = respUser.name;
      }

      if (!draft.approvalNotifications) draft.approvalNotifications = [];
      const directorIds = draft.users
        .filter((u) => u.role === 'director' && u.isActive !== false)
        .map((u) => u.id);
      const targetIds = Array.from(
        new Set(
          [
            ...directorIds,
            nextRecord.responsibleUserId,
            nextRecord.accountableUserId,
            currentUser.id,
          ].filter(Boolean)
        )
      );
      draft.approvalNotifications.unshift({
        id: `notif-raci-sub-${outputId}-${Date.now()}`,
        approvalItemId: `raci-${outputId}`,
        referenceNumber: `RACI/${outputId.toUpperCase()}`,
        documentTitle: `RACI Output: ${outp?.name || outputId}`,
        categoryCode: 'tor',
        categoryLabel: 'RACI Output',
        eventType: 'ENTER_VERIFICATION',
        message: `${currentUser.name} mengajukan penugasan RACI Output "${outp?.name || outputId}" (R: ${nextRecord.responsibleUserName || '-'}, A1: ${nextRecord.accountableUserName || '-'}) untuk persetujuan Direktur.`,
        targetUserIds: targetIds,
        targetRoleCodes: ['Direktur', 'A1', 'R'],
        createdAt: nowIso,
        isReadByUserIds: [currentUser.id],
      });

      // Requirement 10: Any RACI reassignment must trigger the established reapproval mechanism
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
          if (
            a1Changed &&
            item.groupType === 'program_documents' &&
            item.status === 'Approved'
          ) {
            item.status = 'Pending Verification';
            item.isLocked = false;
            item.currentStepNumber = 2;
            item.currentActiveRole = 'A1';
          }
          item.updatedAt = nowIso;
          item.timeline = item.timeline || [];
          item.timeline.unshift({
            id: `tl-raci-reassign-${item.id}-${Date.now()}`,
            timestamp: nowIso,
            actorId: currentUser.id,
            actorName: currentUser.name,
            actorRoleCode: currentUser.role === 'director' ? 'Direktur' : 'A1',
            actorRoleTitle: currentUser.roleTitle,
            responsibleName: item.responsibleUserName,
            actionLabel: 'Perubahan RACI Output — Memicu Mekanisme Persetujuan Ulang',
            resultingStatus: item.status,
            comment: `Penugasan RACI Output "${outp?.name || outputId}" diperbarui (R: ${nextRecord.responsibleUserName || '-'}, A1: ${nextRecord.accountableUserName || '-'}). Menunggu pengesahan ulang sesuai alur persetujuan.`,
            version: item.version || 1,
          });
        }
      }

      draft.auditLogs.unshift({
        id: `log-raci-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: isReassignment
          ? 'Perubahan RACI Output (Memicu Persetujuan Ulang)'
          : 'Penugasan RACI Output (MEAL Connect)',
        entityType: 'PROGRAM',
        entityId: outputId,
        details: `Menentukan RACI untuk Output "${outp?.name || outputId}" (R: ${nextRecord.responsibleUserName || '-'}, A: ${nextRecord.accountableUserName || '-'}) — Status: ${nextRecord.status}.`,
        timestamp: nowIso,
      });
    });

    res.json(savedRecord);
  });

  app.post('/api/monitoring-connect/raci/:outputId/approve', (req: Request, res: Response) => {
    const { outputId } = req.params;
    const currentUser = getCurrentUser(req);
    if (currentUser.isActive === false) {
      return res.status(403).json({
        error: 'Akun Anda berstatus nonaktif dan tidak dapat memberikan pengesahan RACI.',
      });
    }
    if (currentUser.role !== 'director') {
      return res.status(403).json({
        error: 'Hanya Direktur Eksekutif yang memiliki kewenangan mengesahkan atau meminta revisi penugasan RACI Output.',
      });
    }
    const body = req.body || {};
    const decision: 'approve' | 'revision' = body.decision === 'revision' ? 'revision' : 'approve';
    const nowIso = new Date().toISOString();

    let savedRecord: OutputRaciRecord | null = null;

    db.update((draft) => {
      if (!draft.outputRaciRecords) draft.outputRaciRecords = {};
      const prev = draft.outputRaciRecords[outputId];
      if (!prev) return;
      const outp = draft.outputs.find((o) => o.id === outputId);
      const notesText = String(body.directorNotes ?? '').trim();

      const prevHistory = Array.isArray(prev.auditHistory) ? [...prev.auditHistory] : [];
      const decisionAuditEntry: NonNullable<OutputRaciRecord['auditHistory']>[number] = {
        id: `raci-aud-${Date.now()}`,
        timestamp: nowIso,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action:
          decision === 'approve'
            ? 'Disetujui Direktur (RACI Aktif)'
            : 'Diminta Revisi oleh Direktur',
        status: decision === 'approve' ? 'Aktif' : 'Menunggu Program Manager',
        notes:
          notesText ||
          (decision === 'approve'
            ? 'Penugasan R & A disetujui Direktur.'
            : 'Direktur meminta revisi penugasan RACI.'),
        rName: prev.responsibleUserName || '-',
        a1Name: prev.accountableUserName || '-',
      };

      const nextRecord: OutputRaciRecord = {
        ...prev,
        status: decision === 'approve' ? 'Aktif' : 'Menunggu Program Manager',
        approvedById: decision === 'approve' ? currentUser.id : undefined,
        approvedByName: decision === 'approve' ? currentUser.name : undefined,
        approvedAt: decision === 'approve' ? nowIso : undefined,
        directorNotes: notesText,
        auditHistory: [decisionAuditEntry, ...prevHistory],
        updatedAt: nowIso,
      };

      draft.outputRaciRecords[outputId] = nextRecord;
      savedRecord = nextRecord;

      if (!draft.approvalNotifications) draft.approvalNotifications = [];
      const pmIds = draft.users
        .filter((u) => u.role === 'program_manager' && u.isActive !== false)
        .map((u) => u.id);
      const directorIds = draft.users
        .filter((u) => u.role === 'director' && u.isActive !== false)
        .map((u) => u.id);
      const targetIds = Array.from(
        new Set(
          [
            ...pmIds,
            ...directorIds,
            prev.assignedById,
            prev.responsibleUserId,
            prev.accountableUserId,
          ].filter((id): id is string => Boolean(id))
        )
      );

      draft.approvalNotifications.unshift({
        id: `notif-raci-${decision}-${outputId}-${Date.now()}`,
        approvalItemId: `raci-${outputId}`,
        referenceNumber: `RACI/${outputId.toUpperCase()}`,
        documentTitle: `RACI Output: ${outp?.name || outputId}`,
        categoryCode: 'tor',
        categoryLabel: 'RACI Output',
        eventType: decision === 'approve' ? 'APPROVED' : 'REVISION_REQUIRED',
        message:
          decision === 'approve'
            ? `Direktur (${currentUser.name}) menyetujui penugasan RACI Output "${outp?.name || outputId}" (R: ${prev.responsibleUserName}, A1: ${prev.accountableUserName}).`
            : `Direktur (${currentUser.name}) meminta revisi penugasan RACI Output "${outp?.name || outputId}"${notesText ? ` — Catatan: "${notesText}"` : '.'}`,
        targetUserIds: targetIds,
        targetRoleCodes: ['A1', 'R', 'Direktur'],
        createdAt: nowIso,
        isReadByUserIds: [currentUser.id],
      });

      draft.auditLogs.unshift({
        id: `log-raci-app-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action:
          decision === 'approve'
            ? 'Persetujuan Direktur RACI Output'
            : 'Permintaan Revisi RACI Output',
        entityType: 'PROGRAM',
        entityId: outputId,
        details: `${decision === 'approve' ? 'Menyetujui' : 'Meminta revisi'} penugasan RACI Output "${outp?.name || outputId}" (R: ${prev.responsibleUserName}, A: ${prev.accountableUserName})${notesText ? ` — Catatan: ${notesText}` : ''}.`,
        timestamp: nowIso,
      });
    });

    if (!savedRecord) {
      return res.status(404).json({ error: 'Data RACI untuk Output ini belum tersedia.' });
    }

    res.json(savedRecord);
  });

  app.post('/api/monitoring-connect/activity/:activityId', (req: Request, res: Response) => {
    const { activityId } = req.params;
    const currentUser = getCurrentUser(req);
    if (currentUser.isActive === false) {
      return res.status(403).json({
        error: 'Akun Anda berstatus nonaktif dan tidak dapat mengelola Monitoring Tools.',
      });
    }
    const body = req.body || {};
    const nowIso = new Date().toISOString();

    const currentData = db.getData();
    const targetAct = currentData.activities.find((a) => a.id === activityId);
    const targetOutp = currentData.outputs.find(
      (o) => o.id === (body.outputId || targetAct?.outputId)
    );
    const targetRaci = targetOutp
      ? currentData.outputRaciRecords?.[targetOutp.id]
      : undefined;

    if (!targetRaci || targetRaci.status !== 'Aktif') {
      return res.status(403).json({
        error:
          targetRaci?.status === 'Menunggu Persetujuan Direktur'
            ? 'Penugasan RACI pada Output ini masih menunggu persetujuan Direktur. Pengelolaan Monitoring Tools belum diizinkan.'
            : 'Penugasan RACI pada Output ini belum aktif.',
      });
    }

    const isR = targetRaci.responsibleUserId === currentUser.id;
    const isA1 = targetRaci.accountableUserId === currentUser.id;
    const isA2 =
      currentUser.role === 'finance' ||
      (currentUser.roleTitle || '').toLowerCase().includes('finance');

    if (!isR && !isA1 && !isA2) {
      return res.status(403).json({
        error:
          'Hanya user dengan penugasan R (Responsible), A1 (Accountable Program), atau A2 (Accountable Finance) yang dapat mengelola Monitoring Tools pada Output ini.',
      });
    }

    const actorRaciLabel = isR
      ? 'R – Responsible'
      : isA1
      ? 'A1 – Accountable Program'
      : 'A2 – Accountable Finance';

    let savedRecord: ActivityMonitoringRecord | null = null;

    db.update((draft) => {
      if (!draft.activityMonitoringRecords) draft.activityMonitoringRecords = {};
      const act = draft.activities.find((a) => a.id === activityId);
      const outp = draft.outputs.find((o) => o.id === act?.outputId);
      const outc = draft.outcomes.find((oc) => oc.id === outp?.outcomeId);

      const rawTools = Array.isArray(body.tools) ? body.tools : [];
      const tools = rawTools.map((t: any) => ({
        toolId: String(t.toolId || ''),
        toolName: String(t.toolName || ''),
        categoryCode: (t.categoryCode || 'A') as 'A' | 'B' | 'C' | 'D' | 'E',
        categoryName: String(t.categoryName || ''),
        shortFunction: String(t.shortFunction || ''),
        toolUrl: String(t.toolUrl || ''),
        notes: String(t.notes || ''),
        assignedAt: t.assignedAt || nowIso,
        assignedById: t.assignedById || currentUser.id,
        assignedByName: t.assignedByName || currentUser.name,
      }));

      const nextRecord: ActivityMonitoringRecord = {
        activityId,
        outputId: body.outputId || act?.outputId || '',
        outcomeId: body.outcomeId || outp?.outcomeId || '',
        programId: body.programId || outc?.programId || '',
        tools,
        status: tools.length > 0 ? 'Sudah Ada Monitoring' : 'Belum Ada Monitoring',
        updatedById: currentUser.id,
        updatedByName: currentUser.name,
        updatedAt: nowIso,
      };

      draft.activityMonitoringRecords[activityId] = nextRecord;
      savedRecord = nextRecord;

      draft.auditLogs.unshift({
        id: `log-mon-act-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: 'Pembaruan Monitoring Tools Activity',
        entityType: 'PROGRAM',
        entityId: activityId,
        details: `Menyimpan ${tools.length} Monitoring Tools untuk Activity "${act?.name || activityId}" oleh ${currentUser.name} [${actorRaciLabel}] — Status: ${nextRecord.status}.`,
        timestamp: nowIso,
      });
    });

    res.json(savedRecord);
  });

  // ============================================================================
  // MODUL 06: MONITORING REPORTS (AUTO-SYNC TOR + CASH ADVANCE + PLANNED TOOLS)
  // ============================================================================
  function createEmptyMonitoringSections(): MonitoringReportSections {
    return {
      baseline: {
        narrative: '',
        evidenceLinks: [{ id: `ev-a-${Date.now()}`, label: '', url: '' }],
      },
      intervention: {
        narrative: '',
        evidenceLinks: [{ id: `ev-b-${Date.now()}`, label: '', url: '' }],
      },
      results: {
        narrative: '',
        evidenceLinks: [{ id: `ev-c-${Date.now()}`, label: '', url: '' }],
      },
      contextLearning: {
        narrative: '',
        evidenceLinks: [{ id: `ev-d-${Date.now()}`, label: '', url: '' }],
      },
      reflectionLearning: {
        narrative: '',
        evidenceLinks: [{ id: `ev-e-${Date.now()}`, label: '', url: '' }],
      },
      keySuccessParticipation: {
        narrative: '',
        evidenceLinks: [{ id: `ev-f-${Date.now()}`, label: '', url: '' }],
      },
      nextImplementationProposal: {
        narrative: '',
        evidenceLinks: [{ id: `ev-g-${Date.now()}`, label: '', url: '' }],
      },
    };
  }

  function syncMonitoringReportsForTor(draft: any, targetTorId?: string): MonitoringReportItem[] {
    if (!draft.monitoringReports || typeof draft.monitoringReports !== 'object') {
      draft.monitoringReports = {};
    }

    const torsToSync: Tor[] = targetTorId
      ? (draft.tors || []).filter((t: Tor) => t.id === targetTorId)
      : draft.tors || [];

    const nowIso = new Date().toISOString();
    const validIdsForScope = new Set<string>();

    for (const tor of torsToSync) {
      const actMon: ActivityMonitoringRecord | undefined =
        draft.activityMonitoringRecords?.[tor.activityId];
      const plannedTools = Array.isArray(actMon?.tools) ? actMon!.tools : [];

      // Ketentuan 5: Jangan membuat monitoring baru secara otomatis jika jenis monitoring belum direncanakan
      if (plannedTools.length === 0) {
        continue;
      }

      // Cash Advance yang masuk untuk ToR ini (tidak ditolak)
      const torCashAdvances: CashAdvanceRecord[] = (draft.cashAdvances || []).filter(
        (ca: CashAdvanceRecord) => ca.torId === tor.id && ca.status !== 'Ditolak'
      );

      if (torCashAdvances.length === 0) {
        continue;
      }

      const outpRaci: OutputRaciRecord | undefined = draft.outputRaciRecords?.[tor.outputId];
      const fallbackResponsibleId = tor.picId || outpRaci?.responsibleUserId || '';
      const fallbackResponsibleName =
        tor.picName || tor.createdByName || outpRaci?.responsibleUserName || '';

      const timelineItems = Array.isArray(tor.timelineItems) ? tor.timelineItems : [];

      for (const ca of torCashAdvances) {
        // Responsible Monitoring otomatis dari user yang membuat Cash Advance (CA)
        const caResponsibleId = ca.requesterId || fallbackResponsibleId;
        const caResponsibleName =
          ca.requesterName ||
          ca.signatures?.requestedBy?.name ||
          fallbackResponsibleName;

        const linkedIds = new Set<string>();
        if (ca.implementationMode === 'all') {
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

        const matchedTimelines: { id: string; period: string; activity: string; stageIndex: number }[] = [];
        timelineItems.forEach((tl, idx) => {
          if (tl && linkedIds.has(tl.id)) {
            matchedTimelines.push({
              id: tl.id,
              period: tl.period || '',
              activity: tl.activity,
              stageIndex: idx + 1,
            });
          }
        });

        if (matchedTimelines.length === 0) {
          matchedTimelines.push({
            id: `ca-tl-${ca.id}`,
            period: ca.activityStartDate || tor.startDate || '',
            activity:
              ca.implementationTimelineSummary || ca.activityTitle || tor.activityName || tor.title,
            stageIndex: 1,
          });
        }

        const defaultDate =
          ca.activityStartDate || ca.requestDate || tor.startDate || nowIso.slice(0, 10);

        matchedTimelines.forEach((tl, tlIdxInCa) => {
          const periodLabel = tl.period ? ` (${tl.period})` : '';
          const implLabel = `Tahap ${tl.stageIndex}${periodLabel}: ${tl.activity}`;

          for (const tool of plannedTools) {
            if (!tool.toolId) continue;
            const itemId =
              tlIdxInCa === 0
                ? `${tor.id}__${ca.id}__${tool.toolId}`
                : `${tor.id}__${ca.id}__${tl.id}__${tool.toolId}`;
            validIdsForScope.add(itemId);

            const existing: MonitoringReportItem | undefined = draft.monitoringReports[itemId];
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
                toolCategoryCode: tool.categoryCode || 'A',
                toolCategoryName: tool.categoryName || '',
                toolShortFunction: tool.shortFunction || '',
                toolNotes: tool.notes || '',
                plannedToolUrl: tool.toolUrl || '',
                responsibleUserId: caResponsibleId,
                responsibleName: caResponsibleName,
                monitoringDate: defaultDate,
                status: 'Planned',
                mainEvidenceFolderUrl: '',
                sections: createEmptyMonitoringSections(),
                createdAt: nowIso,
                updatedAt: nowIso,
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
              existing.toolCategoryCode = tool.categoryCode || existing.toolCategoryCode || 'A';
              existing.toolCategoryName = tool.categoryName || existing.toolCategoryName || '';
              existing.toolShortFunction = tool.shortFunction || existing.toolShortFunction || '';
              existing.toolNotes = tool.notes || existing.toolNotes || '';
              existing.plannedToolUrl = tool.toolUrl || existing.plannedToolUrl || '';
              existing.responsibleUserId = caResponsibleId;
              existing.responsibleName = caResponsibleName;
            }
          }

          // Buat / sinkronkan item khusus Executive Summary (7 Bagian A-G) untuk setiap Implementasi-Aktivitas
          const execItemId = `${tor.id}__${ca.id}__${tl.id}__EXEC-SUMMARY`;
          validIdsForScope.add(execItemId);
          const existingExec: MonitoringReportItem | undefined = draft.monitoringReports[execItemId];
          if (!existingExec) {
            // Jika tlIdxInCa === 0 dan ada seed awal di tool pertama yang sudah punya sections, salin ke Executive Summary
            const seedSource =
              tlIdxInCa === 0 && plannedTools[0]?.toolId
                ? draft.monitoringReports[`${tor.id}__${ca.id}__${plannedTools[0].toolId}`]
                : undefined;
            const hasSeedSections =
              seedSource &&
              seedSource.sections &&
              Object.values(seedSource.sections).some(
                (s: any) => s?.narrative && String(s.narrative).trim() !== ''
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
              toolId: 'EXEC-SUMMARY',
              toolName: 'Executive Summary',
              toolCategoryCode: 'A',
              toolCategoryName: 'Executive Summary (7 Bagian Form Monitoring & Evidence)',
              toolShortFunction:
                'Ringkasan eksekutif pelaksanaan kegiatan mencakup 7 bagian pembelajaran & dampak (A–G).',
              toolNotes:
                'A. Baseline, B. Intervention, C. Hasil, D. Context Learning, E. Reflection & Learning, F. Key Success Participation, G. Usulan Implementasi Selanjutnya',
              plannedToolUrl: '',
              responsibleUserId: caResponsibleId,
              responsibleName: caResponsibleName,
              monitoringDate: defaultDate,
              status: hasSeedSections ? seedSource!.status : 'Planned',
              mainEvidenceFolderUrl: hasSeedSections ? seedSource!.mainEvidenceFolderUrl || '' : '',
              sections: hasSeedSections
                ? JSON.parse(JSON.stringify(seedSource!.sections))
                : createEmptyMonitoringSections(),
              createdAt: nowIso,
              updatedAt: nowIso,
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

    const allItems: MonitoringReportItem[] = Object.values(draft.monitoringReports || {});
    const filtered = targetTorId
      ? allItems.filter((item) => item.torId === targetTorId && validIdsForScope.has(item.id))
      : allItems.filter((item) => validIdsForScope.has(item.id));

    return filtered.sort((a, b) => {
      const caCmp = a.cashAdvanceNumber.localeCompare(b.cashAdvanceNumber);
      if (caCmp !== 0) return caCmp;
      if (a.toolId === 'EXEC-SUMMARY' && b.toolId !== 'EXEC-SUMMARY') return 1;
      if (b.toolId === 'EXEC-SUMMARY' && a.toolId !== 'EXEC-SUMMARY') return -1;
      return a.toolId.localeCompare(b.toolId);
    });
  }

  app.get('/api/monitoring-reports', (req: Request, res: Response) => {
    const torId = typeof req.query.torId === 'string' ? req.query.torId : undefined;
    let syncedItems: MonitoringReportItem[] = [];
    let plannedTools: SelectedActivityMonitoringTool[] = [];
    let plannedToolsCount = 0;
    let cashAdvanceCount = 0;

    db.update((draft) => {
      syncedItems = syncMonitoringReportsForTor(draft, torId);
      if (torId) {
        const targetTor = (draft.tors || []).find((t: Tor) => t.id === torId);
        if (targetTor) {
          plannedTools =
            draft.activityMonitoringRecords?.[targetTor.activityId]?.tools || [];
          plannedToolsCount = plannedTools.length;
          cashAdvanceCount = (draft.cashAdvances || []).filter(
            (ca: CashAdvanceRecord) => ca.torId === torId && ca.status !== 'Ditolak'
          ).length;
        }
      }
    });

    res.json({
      items: syncedItems,
      plannedTools,
      plannedToolsCount,
      cashAdvanceCount,
    });
  });

  app.put('/api/monitoring-reports/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);
    const body = req.body || {};
    const nowIso = new Date().toISOString();

    let updatedItem: MonitoringReportItem | null = null;

    db.update((draft) => {
      if (!draft.monitoringReports) draft.monitoringReports = {};
      const existing = draft.monitoringReports[id];
      if (!existing) return;

      const normalizeSection = (
        incoming: any,
        fallback: { narrative: string; evidenceLinks: { id: string; label?: string; url: string }[] },
        prefix: string
      ) => {
        const narrative =
          incoming && typeof incoming.narrative === 'string'
            ? incoming.narrative
            : fallback?.narrative || '';
        const rawLinks = Array.isArray(incoming?.evidenceLinks)
          ? incoming.evidenceLinks
          : fallback?.evidenceLinks || [];
        const evidenceLinks =
          rawLinks.length > 0
            ? rawLinks.map((lnk: any, i: number) => ({
                id: String(lnk?.id || `ev-${prefix}-${Date.now()}-${i}`),
                label: String(lnk?.label || ''),
                url: String(lnk?.url || ''),
              }))
            : [{ id: `ev-${prefix}-${Date.now()}-0`, label: '', url: '' }];
        return { narrative, evidenceLinks };
      };

      const nextSections: MonitoringReportSections = body.sections
        ? {
            baseline: normalizeSection(body.sections.baseline, existing.sections.baseline, 'a'),
            intervention: normalizeSection(
              body.sections.intervention,
              existing.sections.intervention,
              'b'
            ),
            results: normalizeSection(body.sections.results, existing.sections.results, 'c'),
            contextLearning: normalizeSection(
              body.sections.contextLearning,
              existing.sections.contextLearning,
              'd'
            ),
            reflectionLearning: normalizeSection(
              body.sections.reflectionLearning,
              existing.sections.reflectionLearning,
              'e'
            ),
            keySuccessParticipation: normalizeSection(
              body.sections.keySuccessParticipation,
              existing.sections.keySuccessParticipation,
              'f'
            ),
            nextImplementationProposal: normalizeSection(
              body.sections.nextImplementationProposal,
              existing.sections.nextImplementationProposal,
              'g'
            ),
          }
        : existing.sections;

      const nextInvolvedParticipantIds: string[] = Array.isArray(body.involvedParticipantIds)
        ? Array.from(new Set(body.involvedParticipantIds.map((x: any) => String(x || '').trim()).filter(Boolean)))
        : Array.isArray(existing.involvedParticipantIds)
        ? existing.involvedParticipantIds
        : [];

      // Determine status
      let nextStatus: MonitoringReportStatus = existing.status;
      if (
        body.status === 'Planned' ||
        body.status === 'In Progress' ||
        body.status === 'Completed'
      ) {
        nextStatus = body.status;
      } else {
        // Auto-promote Planned -> In Progress if any content or folder link or participant is filled
        const hasAnyInput =
          nextInvolvedParticipantIds.length > 0 ||
          Boolean(String(body.mainEvidenceFolderUrl ?? existing.mainEvidenceFolderUrl).trim()) ||
          Object.values(nextSections).some(
            (sec: any) =>
              sec.narrative.trim() !== '' ||
              sec.evidenceLinks.some((l: any) => l.url.trim() !== '' || (l.label || '').trim() !== '')
          );
        if (existing.status === 'Planned' && hasAnyInput) {
          nextStatus = 'In Progress';
        }
      }

      const linkedCa = (draft.cashAdvances || []).find(
        (c: CashAdvanceRecord) => c.id === existing.cashAdvanceId
      );
      const autoResponsibleId = linkedCa?.requesterId || existing.responsibleUserId;
      const autoResponsibleName =
        linkedCa?.requesterName ||
        linkedCa?.signatures?.requestedBy?.name ||
        existing.responsibleName;

      const nextRecord: MonitoringReportItem = {
        ...existing,
        monitoringDate:
          typeof body.monitoringDate === 'string' && body.monitoringDate.trim()
            ? body.monitoringDate.trim()
            : existing.monitoringDate,
        responsibleUserId: autoResponsibleId,
        responsibleName: autoResponsibleName,
        mainEvidenceFolderUrl:
          typeof body.mainEvidenceFolderUrl === 'string'
            ? body.mainEvidenceFolderUrl.trim()
            : existing.mainEvidenceFolderUrl,
        status: nextStatus,
        sections: nextSections,
        involvedParticipantIds: nextInvolvedParticipantIds,
        updatedById: currentUser.id,
        updatedByName: currentUser.name,
        updatedAt: nowIso,
      };

      draft.monitoringReports[id] = nextRecord;
      updatedItem = nextRecord;

      // Sync involved participants with Program, Outcome, and Activity in Database Peserta (no duplication)
      if (nextInvolvedParticipantIds.length > 0 && existing.programId && Array.isArray(draft.participantDatabase)) {
        const prog = (draft.programs || []).find((p: Program) => p.id === existing.programId);
        if (prog) {
          const selectedSet = new Set(nextInvolvedParticipantIds);
          for (let i = 0; i < draft.participantDatabase.length; i++) {
            const pRec = draft.participantDatabase[i];
            if (!selectedSet.has(pRec.id)) continue;
            const currentInvs: ParticipantProgramInvolvement[] = Array.isArray(pRec.programInvolvements)
              ? [...pRec.programInvolvements]
              : [];
            const invIdx = currentInvs.findIndex((inv) => inv.programId === prog.id);
            if (invIdx !== -1) {
              const prevOutIds = Array.isArray(currentInvs[invIdx].outcomeIds)
                ? currentInvs[invIdx].outcomeIds!
                : [];
              const prevActIds = Array.isArray(currentInvs[invIdx].activityIds)
                ? currentInvs[invIdx].activityIds!
                : [];
              currentInvs[invIdx] = {
                ...currentInvs[invIdx],
                outcomeIds: existing.outcomeId
                  ? Array.from(new Set([...prevOutIds, existing.outcomeId]))
                  : prevOutIds,
                activityIds: existing.activityId
                  ? Array.from(new Set([...prevActIds, existing.activityId]))
                  : prevActIds,
              };
            } else {
              currentInvs.push({
                programId: prog.id,
                programCode: prog.code,
                programName: prog.name,
                roleInProgram:
                  pRec.participantType === 'INDIVIDU' ? pRec.communityRole : pRec.programRole,
                outcomeIds: existing.outcomeId ? [existing.outcomeId] : [],
                activityIds: existing.activityId ? [existing.activityId] : [],
                joinedAt: nowIso.slice(0, 10),
              });
            }
            draft.participantDatabase[i] = {
              ...pRec,
              programInvolvements: currentInvs,
              updatedAt: nowIso,
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
          action:
            nextStatus === 'Completed'
              ? 'Penyelesaian Laporan Monitoring (Tahap 06)'
              : 'Pembaruan Draft Monitoring (Tahap 06)',
          entityType: 'TOR',
          entityId: existing.torId,
          details: `Memperbarui Monitoring [${existing.toolId} ${existing.toolName}] pada Cash Advance ${existing.cashAdvanceNumber} (ToR ${existing.torNumber}) — Status: ${nextStatus}.`,
          timestamp: nowIso,
        });
      }
    });

    if (!updatedItem) {
      return res.status(404).json({ error: 'Item monitoring tidak ditemukan.' });
    }

    res.json(updatedItem);
  });

  // --- PUSAT PERSETUJUAN (APPROVAL HUB) CENTRALIZED APIS ---

  app.get('/api/approval-hub', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const draft = db.getData();
    syncMonitoringReportsForTor(draft);
    const synced = syncApprovalHubData(draft);
    const accessProfile = resolveUserApprovalAccess(draft, currentUser, synced.items);
    const visibleItems = filterApprovalItemsForUser(synced.items, currentUser, accessProfile);
    const responsibleItems = synced.items.filter(
      (i) => i.responsibleUserId === currentUser.id && i.status !== 'Archived'
    );
    const responsibleItemIds = new Set(responsibleItems.map((i) => i.id));
    res.json({
      items: visibleItems,
      responsibleItems,
      configs: synced.configs,
      notifications: synced.notifications.filter(
        (n) =>
          accessProfile.isDirector ||
          n.targetUserIds.includes(currentUser.id) ||
          responsibleItemIds.has(n.approvalItemId) ||
          ((accessProfile.isFinance || accessProfile.isA2) &&
            (n.targetRoleCodes || []).includes('A2')) ||
          (accessProfile.isA1 && (n.targetRoleCodes || []).includes('A1'))
      ),
      accessProfile,
    });
  });

  app.post('/api/approval-hub/notifications/read', (req: Request, res: Response) => {
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

  app.post('/api/approval-hub/:id/action', (req: Request, res: Response) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);
    const { action, comment } = req.body || {};

    try {
      let result: { item: any; message: string } | null = null;
      db.update((draft) => {
        result = executeApprovalHubAction({
          draft,
          itemId: id,
          actor: currentUser,
          action,
          comment,
        });
        if (result?.item?.sourceTorId) {
          syncTorBudgetInDraft(draft, result.item.sourceTorId);
        }
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Gagal memproses tindakan persetujuan.' });
    }
  });

  // --- FINANCE WORKSPACE AUTHORITATIVE DATABASE APIS ---
  app.get('/api/finance-workspace/budgets', (_req: Request, res: Response) => {
    const data = db.getData();
    res.json(data.programBudgets || {});
  });

  app.put('/api/finance-workspace/budgets/:key', (req: Request, res: Response) => {
    const { key } = req.params;
    const currentUser = getCurrentUser(req);
    if (
      currentUser.role !== 'finance' &&
      currentUser.role !== 'director' &&
      currentUser.role !== 'program_manager' &&
      currentUser.role !== 'admin'
    ) {
      return res.status(403).json({
        error: 'Akses ditolak: Hanya Finance, Direktur, atau Program Manager yang berwenang memperbarui Master Budget.',
      });
    }
    const dataset = req.body;
    if (!dataset || typeof dataset !== 'object') {
      return res.status(400).json({ error: 'Data konfigurasi anggaran tidak valid.' });
    }
    const nowIso = new Date().toISOString();
    let savedDataset: any = null;

    db.update((draft) => {
      if (!draft.programBudgets || typeof draft.programBudgets !== 'object') {
        draft.programBudgets = {};
      }
      savedDataset = {
        ...dataset,
        id: key,
        updatedAt: nowIso,
        updatedBy: currentUser.name,
      };
      draft.programBudgets[key] = savedDataset;

      draft.auditLogs.unshift({
        id: `log-fin-bgt-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: 'Pembaruan Master Budget / Master Budget Code (Finance Workspace)',
        entityType: 'PROGRAM',
        entityId: dataset.programId || key,
        details: `Memperbarui konfigurasi Finance Workspace untuk ${dataset.programName || key} (FY ${dataset.fiscalYear || ''}) oleh ${currentUser.name}.`,
        timestamp: nowIso,
      });
    });

    res.json(savedDataset);
  });

  app.post('/api/approval-hub/workflow-config', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.role !== 'director' && currentUser.role !== 'admin') {
      return res.status(403).json({
        error: 'Akses ditolak: Hanya Direktur yang berwenang mengubah mekanisme alur persetujuan (Approval Hub).',
      });
    }
    const { categoryCode, mechanism, parallelRule } = req.body || {};
    if (!categoryCode || !mechanism) {
      return res.status(400).json({ error: 'Kategori dan mekanisme alur persetujuan wajib diisi.' });
    }
    const nowIso = new Date().toISOString();
    let updatedConfigs: Record<string, any> = {};

    db.update((draft) => {
      const synced = syncApprovalHubData(draft);
      updatedConfigs = synced.configs;
      updatedConfigs[categoryCode] = {
        categoryCode,
        mechanism: mechanism === 'PARALLEL' ? 'PARALLEL' : 'SEQUENTIAL',
        parallelRule: parallelRule || 'PRIMARY_WITH_CONSULTATION',
        updatedAt: nowIso,
        updatedByName: currentUser.name,
      };
      // Update existing non-locked items of this category to reflect workflow config
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
        action: 'Pengaturan Alur Persetujuan (Approval Hub)',
        entityType: 'TOR',
        entityId: categoryCode,
        details: `Mengubah mekanisme persetujuan kategori [${categoryCode}] menjadi ${mechanism} (${
          parallelRule || 'PRIMARY_WITH_CONSULTATION'
        }).`,
        timestamp: nowIso,
      });
    });

    res.json({
      message: 'Pengaturan mekanisme alur persetujuan berhasil diperbarui.',
      configs: updatedConfigs,
    });
  });

  // --- DATABASE PESERTA (MASTER DATA MANDIRI) APIS ---
  const GROUP_COMPOSITION_KEYS: GroupCompositionRowKey[] = [
    'anak',
    'remaja',
    'pemuda',
    'dewasa',
    'lansia',
  ];

  function sanitizeNonNegativeInt(val: any): number {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
  }

  function normalizeGroupComposition(raw: any): {
    matrix: GroupMemberCompositionMatrix;
    totalMembers: number;
  } {
    const matrix = {} as GroupMemberCompositionMatrix;
    let totalMembers = 0;
    for (const key of GROUP_COMPOSITION_KEYS) {
      const row = raw && typeof raw === 'object' ? raw[key] || {} : {};
      const lakiLaki = sanitizeNonNegativeInt(row.lakiLaki);
      const perempuan = sanitizeNonNegativeInt(row.perempuan);
      const lainnya = sanitizeNonNegativeInt(row.lainnya);
      const memilihTidakMenjawab = sanitizeNonNegativeInt(row.memilihTidakMenjawab);
      matrix[key] = {
        lakiLaki,
        perempuan,
        lainnya,
        memilihTidakMenjawab,
      };
      totalMembers += lakiLaki + perempuan + lainnya + memilihTidakMenjawab;
    }
    return { matrix, totalMembers };
  }

  function getNextParticipantCode(
    records: MasterParticipantRecord[],
    type: 'INDIVIDU' | 'KELOMPOK/ORGANISASI'
  ): string {
    const prefix = type === 'INDIVIDU' ? 'IND-' : 'KLP-';
    let maxSeq = 0;
    for (const r of records) {
      if (r.participantType === type && typeof r.participantCode === 'string') {
        const match = r.participantCode.match(/(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxSeq) {
            maxSeq = num;
          }
        }
      }
    }
    return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
  }

  function normalizeParticipantProgramInvolvements(
    raw: any,
    programs: Program[],
    fallbackNowIso: string
  ): ParticipantProgramInvolvement[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const result: ParticipantProgramInvolvement[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const programId = String(item.programId || '').trim();
      if (!programId || seen.has(programId)) continue;
      const matchedProg = (programs || []).find((p) => p.id === programId);
      const programName = matchedProg?.name || String(item.programName || '').trim();
      if (!programName) continue;
      seen.add(programId);
      const rolesArr = Array.isArray(item.rolesInProgram)
        ? item.rolesInProgram.map((r: any) => String(r || '').trim()).filter(Boolean)
        : item.roleInProgram
        ? String(item.roleInProgram)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const outcomeIds: string[] | undefined = Array.isArray(item.outcomeIds)
        ? Array.from(new Set(item.outcomeIds.map((x: any) => String(x || '').trim()).filter(Boolean)))
        : undefined;
      const activityIds: string[] | undefined = Array.isArray(item.activityIds)
        ? Array.from(new Set(item.activityIds.map((x: any) => String(x || '').trim()).filter(Boolean)))
        : undefined;
      result.push({
        programId,
        programCode: matchedProg?.code || (item.programCode ? String(item.programCode).trim() : undefined),
        programName,
        roleInProgram:
          rolesArr.length > 0
            ? rolesArr.join(', ')
            : item.roleInProgram
            ? String(item.roleInProgram).trim()
            : undefined,
        rolesInProgram: rolesArr.length > 0 ? rolesArr : undefined,
        outcomeIds: outcomeIds && outcomeIds.length > 0 ? outcomeIds : undefined,
        activityIds: activityIds && activityIds.length > 0 ? activityIds : undefined,
        joinedAt: item.joinedAt ? String(item.joinedAt).trim() : fallbackNowIso.slice(0, 10),
        notes: item.notes ? String(item.notes).trim() : undefined,
      });
    }
    return result;
  }

  app.get('/api/participant-database', (_req: Request, res: Response) => {
    const data = db.getData();
    const rawRecords = Array.isArray(data.participantDatabase) ? data.participantDatabase : [];
    const programs = Array.isArray(data.programs) ? data.programs : [];
    const nowIso = new Date().toISOString();
    const records = rawRecords.map((r) => ({
      ...r,
      programInvolvements: normalizeParticipantProgramInvolvements(
        r.programInvolvements,
        programs,
        r.createdAt || nowIso
      ),
    }));
    const auditLogs = (Array.isArray(data.auditLogs) ? data.auditLogs : []).filter(
      (log) => log.entityType === 'PARTICIPANT'
    );
    res.json({
      records,
      nextIndividualCode: getNextParticipantCode(records, 'INDIVIDU'),
      nextGroupCode: getNextParticipantCode(records, 'KELOMPOK/ORGANISASI'),
      auditLogs,
    });
  });

  app.post('/api/participant-database', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const body = req.body || {};
    const participantType = body.participantType;

    if (participantType !== 'INDIVIDU' && participantType !== 'KELOMPOK/ORGANISASI') {
      return res.status(400).json({ error: 'Jenis peserta wajib dipilih (INDIVIDU atau KELOMPOK/ORGANISASI).' });
    }

    const nowIso = new Date().toISOString();
    let createdRecord: MasterParticipantRecord | null = null;

    if (participantType === 'INDIVIDU') {
      const fullName = String(body.fullName || '').trim();
      if (!fullName) {
        return res.status(400).json({ error: 'Nama Lengkap wajib diisi.' });
      }
      db.update((draft) => {
        if (!Array.isArray(draft.participantDatabase)) {
          draft.participantDatabase = [];
        }
        const participantCode = getNextParticipantCode(draft.participantDatabase, 'INDIVIDU');
        const involvements = normalizeParticipantProgramInvolvements(
          body.programInvolvements,
          draft.programs || [],
          nowIso
        );
        const communityRolesArr = Array.isArray(body.communityRoles)
          ? body.communityRoles.map((x: any) => String(x || '').trim()).filter(Boolean)
          : body.communityRole
          ? String(body.communityRole)
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : ['Masyarakat Umum'];
        const normalizedCommunityRoles =
          communityRolesArr.length > 0 ? communityRolesArr : ['Masyarakat Umum'];
        const hasLainnya =
          normalizedCommunityRoles.includes('Lainnya') ||
          String(body.communityRole || '').includes('Lainnya');

        const newIndividu: MasterIndividualParticipant = {
          id: `pst-ind-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          participantType: 'INDIVIDU',
          participantCode,
          fullName,
          organizationInstitution: String(body.organizationInstitution || '').trim(),
          ageGroup: body.ageGroup || 'Dewasa (31–59 tahun)',
          gender: body.gender || 'Laki-laki',
          disability: body.disability || 'Tidak',
          disabilityNotes:
            body.disability === 'Ya' ? String(body.disabilityNotes || '').trim() : '',
          communityRole: normalizedCommunityRoles.join(', '),
          communityRoles: normalizedCommunityRoles as any,
          communityRoleNotes: hasLainnya ? String(body.communityRoleNotes || '').trim() : '',
          regionCommunity: String(body.regionCommunity || '').trim(),
          programInvolvements: involvements,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        draft.participantDatabase.unshift(newIndividu);
        createdRecord = newIndividu;

        draft.auditLogs.unshift({
          id: `log-pst-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: 'Tambah Data Peserta Individu (Database Peserta)',
          entityType: 'PARTICIPANT',
          entityId: newIndividu.id,
          details: `Menambahkan peserta individu [${newIndividu.participantCode}] ${newIndividu.fullName}.`,
          timestamp: nowIso,
        });
      });
    } else {
      const groupName = String(body.groupName || '').trim();
      if (!groupName) {
        return res.status(400).json({ error: 'Nama Kelompok/Organisasi wajib diisi.' });
      }
      const { matrix, totalMembers } = normalizeGroupComposition(body.memberComposition);
      db.update((draft) => {
        if (!Array.isArray(draft.participantDatabase)) {
          draft.participantDatabase = [];
        }
        const participantCode = getNextParticipantCode(
          draft.participantDatabase,
          'KELOMPOK/ORGANISASI'
        );
        const involvements = normalizeParticipantProgramInvolvements(
          body.programInvolvements,
          draft.programs || [],
          nowIso
        );
        const programRolesArr = Array.isArray(body.programRoles)
          ? body.programRoles.map((x: any) => String(x || '').trim()).filter(Boolean)
          : body.programRole
          ? String(body.programRole)
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : ['Peserta'];
        const normalizedProgramRoles = programRolesArr.length > 0 ? programRolesArr : ['Peserta'];
        const hasLainnya =
          normalizedProgramRoles.includes('Lainnya') ||
          String(body.programRole || '').includes('Lainnya');

        const newGroup: MasterGroupParticipant = {
          id: `pst-klp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          participantType: 'KELOMPOK/ORGANISASI',
          participantCode,
          groupName,
          groupCategory: body.groupCategory || 'Komunitas',
          groupCategoryNotes:
            body.groupCategory === 'Lainnya' ? String(body.groupCategoryNotes || '').trim() : '',
          regionCommunity: String(body.regionCommunity || '').trim(),
          contactPerson: String(body.contactPerson || '').trim(),
          programRole: normalizedProgramRoles.join(', '),
          programRoles: normalizedProgramRoles as any,
          programRoleNotes: hasLainnya ? String(body.programRoleNotes || '').trim() : '',
          memberComposition: matrix,
          totalMembers,
          programInvolvements: involvements,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        draft.participantDatabase.unshift(newGroup);
        createdRecord = newGroup;

        draft.auditLogs.unshift({
          id: `log-pst-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: 'Tambah Data Kelompok/Organisasi (Database Peserta)',
          entityType: 'PARTICIPANT',
          entityId: newGroup.id,
          details: `Menambahkan kelompok/organisasi [${newGroup.participantCode}] ${newGroup.groupName} (${totalMembers} anggota).`,
          timestamp: nowIso,
        });
      });
    }

    res.status(201).json(createdRecord);
  });

  app.put('/api/participant-database/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);
    const body = req.body || {};
    const nowIso = new Date().toISOString();

    let updatedRecord: MasterParticipantRecord | null = null;
    let errorMsg: string | null = null;

    db.update((draft) => {
      if (!Array.isArray(draft.participantDatabase)) {
        draft.participantDatabase = [];
      }
      const idx = draft.participantDatabase.findIndex((r) => r.id === id);
      if (idx === -1) {
        errorMsg = 'Data peserta tidak ditemukan.';
        return;
      }
      const existing = draft.participantDatabase[idx];
      const nextInvolvements =
        body.programInvolvements !== undefined
          ? normalizeParticipantProgramInvolvements(
              body.programInvolvements,
              draft.programs || [],
              nowIso
            )
          : normalizeParticipantProgramInvolvements(
              existing.programInvolvements,
              draft.programs || [],
              existing.createdAt || nowIso
            );

      if (existing.participantType === 'INDIVIDU') {
        const fullName = String(body.fullName ?? existing.fullName).trim();
        if (!fullName) {
          errorMsg = 'Nama Lengkap wajib diisi.';
          return;
        }
        const disability = body.disability ?? existing.disability;
        const communityRolesArr = Array.isArray(body.communityRoles)
          ? body.communityRoles.map((x: any) => String(x || '').trim()).filter(Boolean)
          : body.communityRole !== undefined
          ? String(body.communityRole)
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : Array.isArray(existing.communityRoles) && existing.communityRoles.length > 0
          ? existing.communityRoles
          : [existing.communityRole || 'Masyarakat Umum'];
        const normalizedCommunityRoles =
          communityRolesArr.length > 0 ? communityRolesArr : ['Masyarakat Umum'];
        const hasLainnya = normalizedCommunityRoles.includes('Lainnya');

        const updatedInd: MasterIndividualParticipant = {
          ...existing,
          fullName,
          organizationInstitution: String(
            body.organizationInstitution ?? existing.organizationInstitution ?? ''
          ).trim(),
          ageGroup: body.ageGroup ?? existing.ageGroup,
          gender: body.gender ?? existing.gender,
          disability,
          disabilityNotes:
            disability === 'Ya'
              ? String(body.disabilityNotes ?? existing.disabilityNotes ?? '').trim()
              : '',
          communityRole: normalizedCommunityRoles.join(', '),
          communityRoles: normalizedCommunityRoles as any,
          communityRoleNotes: hasLainnya
            ? String(body.communityRoleNotes ?? existing.communityRoleNotes ?? '').trim()
            : '',
          regionCommunity: String(body.regionCommunity ?? existing.regionCommunity ?? '').trim(),
          programInvolvements: nextInvolvements,
          updatedAt: nowIso,
        };
        draft.participantDatabase[idx] = updatedInd;
        updatedRecord = updatedInd;

        draft.auditLogs.unshift({
          id: `log-pst-upd-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: 'Perbarui Data Peserta Individu (Database Peserta)',
          entityType: 'PARTICIPANT',
          entityId: updatedInd.id,
          details: `Memperbarui peserta individu [${updatedInd.participantCode}] ${updatedInd.fullName}.`,
          timestamp: nowIso,
        });
      } else {
        const groupName = String(body.groupName ?? existing.groupName).trim();
        if (!groupName) {
          errorMsg = 'Nama Kelompok/Organisasi wajib diisi.';
          return;
        }
        const groupCategory = body.groupCategory ?? existing.groupCategory;
        const programRolesArr = Array.isArray(body.programRoles)
          ? body.programRoles.map((x: any) => String(x || '').trim()).filter(Boolean)
          : body.programRole !== undefined
          ? String(body.programRole)
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : Array.isArray(existing.programRoles) && existing.programRoles.length > 0
          ? existing.programRoles
          : [existing.programRole || 'Peserta'];
        const normalizedProgramRoles = programRolesArr.length > 0 ? programRolesArr : ['Peserta'];
        const hasLainnya = normalizedProgramRoles.includes('Lainnya');

        const { matrix, totalMembers } = normalizeGroupComposition(
          body.memberComposition ?? existing.memberComposition
        );
        const updatedGrp: MasterGroupParticipant = {
          ...existing,
          groupName,
          groupCategory,
          groupCategoryNotes:
            groupCategory === 'Lainnya'
              ? String(body.groupCategoryNotes ?? existing.groupCategoryNotes ?? '').trim()
              : '',
          regionCommunity: String(body.regionCommunity ?? existing.regionCommunity ?? '').trim(),
          contactPerson: String(body.contactPerson ?? existing.contactPerson ?? '').trim(),
          programRole: normalizedProgramRoles.join(', '),
          programRoles: normalizedProgramRoles as any,
          programRoleNotes: hasLainnya
            ? String(body.programRoleNotes ?? existing.programRoleNotes ?? '').trim()
            : '',
          memberComposition: matrix,
          totalMembers,
          programInvolvements: nextInvolvements,
          updatedAt: nowIso,
        };
        draft.participantDatabase[idx] = updatedGrp;
        updatedRecord = updatedGrp;

        draft.auditLogs.unshift({
          id: `log-pst-upd-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: 'Perbarui Data Kelompok/Organisasi (Database Peserta)',
          entityType: 'PARTICIPANT',
          entityId: updatedGrp.id,
          details: `Memperbarui kelompok/organisasi [${updatedGrp.participantCode}] ${updatedGrp.groupName} (${totalMembers} anggota).`,
          timestamp: nowIso,
        });
      }
    });

    if (errorMsg) {
      return res.status(400).json({ error: errorMsg });
    }
    res.json(updatedRecord);
  });

  // Hubungkan Peserta dari Database Peserta ke Program tertentu (tanpa duplikasi data master)
  app.post('/api/programs/:programId/participants-link', (req: Request, res: Response) => {
    const { programId } = req.params;
    const currentUser = getCurrentUser(req);
    const { participantIds, roleInProgram, notes, joinedAt } = req.body || {};

    if (!Array.isArray(participantIds) || participantIds.length === 0) {
      return res.status(400).json({ error: 'Pilih minimal satu peserta dari Database Peserta.' });
    }

    const nowIso = new Date().toISOString();
    let errorMsg: string | null = null;
    const updatedParticipants: MasterParticipantRecord[] = [];

    db.update((draft) => {
      const prog = (draft.programs || []).find((p) => p.id === programId);
      if (!prog) {
        errorMsg = 'Program tidak ditemukan.';
        return;
      }
      if (!Array.isArray(draft.participantDatabase)) {
        draft.participantDatabase = [];
      }

      const idSet = new Set(participantIds.map((x: any) => String(x)));
      for (let i = 0; i < draft.participantDatabase.length; i++) {
        const rec = draft.participantDatabase[i];
        if (!idSet.has(rec.id)) continue;

        const currentInvolvements = normalizeParticipantProgramInvolvements(
          rec.programInvolvements,
          draft.programs || [],
          rec.createdAt || nowIso
        );
        const existingIdx = currentInvolvements.findIndex((inv) => inv.programId === prog.id);
        const involvementItem: ParticipantProgramInvolvement = {
          programId: prog.id,
          programCode: prog.code,
          programName: prog.name,
          roleInProgram: roleInProgram ? String(roleInProgram).trim() : undefined,
          joinedAt: joinedAt ? String(joinedAt).trim() : nowIso.slice(0, 10),
          notes: notes ? String(notes).trim() : undefined,
        };

        if (existingIdx !== -1) {
          currentInvolvements[existingIdx] = {
            ...currentInvolvements[existingIdx],
            ...involvementItem,
            roleInProgram:
              involvementItem.roleInProgram ?? currentInvolvements[existingIdx].roleInProgram,
            notes: involvementItem.notes ?? currentInvolvements[existingIdx].notes,
          };
        } else {
          currentInvolvements.push(involvementItem);
        }

        const updatedRec = {
          ...rec,
          programInvolvements: currentInvolvements,
          updatedAt: nowIso,
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
          action: 'Hubungkan Peserta Master ke Program',
          entityType: 'PARTICIPANT',
          entityId: prog.id,
          details: `Menghubungkan ${updatedParticipants.length} peserta dari Database Peserta ke program "${prog.name}".`,
          timestamp: nowIso,
        });
      }
    });

    if (errorMsg) {
      return res.status(404).json({ error: errorMsg });
    }
    res.json({
      message: `${updatedParticipants.length} peserta berhasil dihubungkan ke program.`,
      updatedParticipants,
    });
  });

  // Lepaskan keterlibatan peserta dari suatu program (tanpa menghapus profil master peserta di Database Peserta)
  app.delete(
    '/api/programs/:programId/participants-link/:participantId',
    (req: Request, res: Response) => {
      const { programId, participantId } = req.params;
      const currentUser = getCurrentUser(req);
      const nowIso = new Date().toISOString();
      let updatedRecord: MasterParticipantRecord | null = null;

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
          updatedAt: nowIso,
        };
        draft.participantDatabase[idx] = nextRec;
        updatedRecord = nextRec;

        const prog = (draft.programs || []).find((p) => p.id === programId);
        const label =
          existing.participantType === 'INDIVIDU' ? existing.fullName : existing.groupName;
        draft.auditLogs.unshift({
          id: `log-pst-unlink-${Date.now()}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.roleTitle,
          action: 'Lepaskan Keterlibatan Program Peserta',
          entityType: 'PARTICIPANT',
          entityId: existing.id,
          details: `Melepaskan keterlibatan [${existing.participantCode}] ${label} dari program "${prog?.name || programId}" (profil master tetap tersimpan di Database Peserta).`,
          timestamp: nowIso,
        });
      });

      if (!updatedRecord) {
        return res.status(404).json({ error: 'Data peserta tidak ditemukan.' });
      }
      res.json(updatedRecord);
    }
  );

  app.delete('/api/participant-database/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const currentUser = getCurrentUser(req);
    if (
      currentUser.role !== 'director' &&
      currentUser.role !== 'program_manager' &&
      currentUser.role !== 'meal' &&
      currentUser.role !== 'admin' &&
      !currentUser.permissions?.canManagePrograms
    ) {
      return res.status(403).json({
        error: 'Akses ditolak: Hanya Direktur, Program Manager, atau MEAL yang berwenang menghapus profil master peserta.',
      });
    }
    const nowIso = new Date().toISOString();
    let deleted = false;

    db.update((draft) => {
      if (!Array.isArray(draft.participantDatabase)) return;
      const idx = draft.participantDatabase.findIndex((r) => r.id === id);
      if (idx === -1) return;
      const target = draft.participantDatabase[idx];
      draft.participantDatabase.splice(idx, 1);
      deleted = true;

      const label =
        target.participantType === 'INDIVIDU' ? target.fullName : target.groupName;
      draft.auditLogs.unshift({
        id: `log-pst-del-${Date.now()}`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.roleTitle,
        action: 'Hapus Data Peserta (Database Peserta)',
        entityType: 'PARTICIPANT',
        entityId: id,
        details: `Menghapus data [${target.participantCode}] ${label} dari Database Peserta.`,
        timestamp: nowIso,
      });
    });

    if (!deleted) {
      return res.status(404).json({ error: 'Data peserta tidak ditemukan.' });
    }
    res.json({ message: 'Data peserta berhasil dihapus.' });
  });

  // ==========================================================================
  // WIJNA ATTENDANCE & TIMESHEET API (MANDIRI — TIDAK TERHUBUNG PROGRAM/MEAL)
  // ==========================================================================

  function appendAttendanceAudit(
    draft: ReturnType<typeof db.getData>,
    actor: User,
    module: AttendanceAuditTrailEntry['module'],
    action: string,
    details: string,
    targetUserName?: string
  ) {
    const sys = ensureAttendanceSystemInitialized(draft);
    const nowIso = new Date().toISOString();
    const entry: AttendanceAuditTrailEntry = {
      id: `att-aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: nowIso,
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.roleTitle,
      module,
      action,
      targetUserName,
      details,
    };
    sys.auditTrail.unshift(entry);
    draft.auditLogs.unshift({
      id: `log-att-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.roleTitle,
      action: `[Attendance & Timesheet] ${action}`,
      entityType: 'ATTENDANCE',
      entityId: entry.id,
      details,
      timestamp: nowIso,
    });
  }

  function isHrAuthorized(user: User): boolean {
    return user.role === 'finance' || user.role === 'hr' || user.role === 'admin';
  }

  function isDirectorAuthorized(user: User): boolean {
    return user.role === 'director' || user.role === 'admin';
  }

  app.get('/api/attendance-system', (req: Request, res: Response) => {
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
      // Privacy by Design: Redact other employees' exact GPS coordinates & private HR/medical notes
      // while preserving Team Calendar visibility and 100% of the current user's own records.
      const redactedRecords = (bundle.records || []).map((rec) =>
        rec.userId === currentUser.id
          ? rec
          : {
              ...rec,
              clockInLatitude: undefined,
              clockInLongitude: undefined,
              clockOutLatitude: undefined,
              clockOutLongitude: undefined,
              outsideLocationReason: undefined,
              clockOutOutsideLocationReason: undefined,
              hrReviewNotes: undefined,
              directorReviewNotes: undefined,
            }
      );
      const redactedLeaves = (bundle.leaveRequests || []).map((lv) =>
        lv.userId === currentUser.id
          ? lv
          : {
              ...lv,
              reason: undefined,
              hrNotes: undefined,
              directorNotes: undefined,
              returnReason: undefined,
            }
      );
      res.json({
        ...bundle,
        records: redactedRecords,
        leaveRequests: redactedLeaves,
        auditTrail: bundle.auditTrail.filter((a) => a.actorId === currentUser.id),
      });
      return;
    }

    res.json(bundle);
  });

  // 1. CLOCK IN + OTOMATIS MEMBUAT TIMESHEET HARIAN
  app.post('/api/attendance-system/clock-in', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const {
      date,
      latitude,
      longitude,
      outsideReason,
      allowOutsideWithHrApproval,
      workItems,
    }: {
      date?: string;
      latitude: number;
      longitude: number;
      gpsAccuracy?: number;
      outsideReason?: string;
      allowOutsideWithHrApproval?: boolean;
      workItems: { category: WijnaWorkCategory; shortDescription: string }[];
    } = req.body || {};

    const targetDate = date && String(date).trim() ? String(date).trim() : new Date().toISOString().slice(0, 10);
    const lat = Number(latitude);
    const lon = Number(longitude);
    const accuracyMargin = Math.min(200, Math.max(0, Math.round(Number(req.body?.gpsAccuracy) || 0)));
    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ error: 'Koordinat lokasi Clock In tidak valid.' });
    }
    if (!Array.isArray(workItems) || workItems.length === 0) {
      return res.status(400).json({ error: 'Pilih minimal satu jenis pekerjaan untuk Timesheet Harian saat Clock In.' });
    }

    let createdOrUpdated: DailyAttendanceTimesheetRecord | null = null;
    let errMsg: string | null = null;

    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);

      // Cek apakah hari ini adalah hari WFA aktif (mendukung single-day, multi-day, & staf yang diajak kolaborasi WFA)
      const activeWfa = sys.wfaRequests.find((w) => {
        const sDate = w.startDate || w.date;
        const eDate = w.endDate || sDate;
        const isParticipant =
          w.userId === currentUser.id ||
          (Array.isArray(w.invitedUserIds) && w.invitedUserIds.includes(currentUser.id));
        return (
          isParticipant &&
          isAttendanceArrangementActiveOnCalendar(w.status, w.workflowType) &&
          sDate <= targetDate &&
          eDate >= targetDate
        );
      });
      if (activeWfa) {
        errMsg =
          'Pada hari WFA yang aktif di kalender, Anda tidak melakukan Clock In/Clock Out. Silakan langsung mengisi Kontribusi Harian WFA.';
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

      const nowIso = new Date().toISOString();
      const activeFlex = sys.flextimeAssignments.find(
        (f) =>
          f.userId === currentUser.id &&
          f.isActive &&
          f.startDate <= targetDate &&
          f.endDate >= targetDate
      );

      const newTimesheetItems: TimesheetWorkItem[] = workItems.slice(0, 2).map((w, idx) => ({
        id: `ts-${Date.now()}-${idx}`,
        category: w.category,
        shortDescription: String(w.shortDescription || w.category).trim(),
        createdAt: nowIso,
      }));

      const existingIdx = sys.records.findIndex(
        (r) => r.userId === currentUser.id && r.date === targetDate
      );

      const clockInLoc = {
        latitude: lat,
        longitude: lon,
        distanceMeters,
        isOutsideWorkLocation: isOutside,
        locationLabel: isOutside
          ? `Outside Work Location (${lat.toFixed(4)}, ${lon.toFixed(4)} • ${distanceMeters}m)`
          : `${sys.locationConfig.officeName} (${distanceMeters}m)`,
        outsideReason: isOutside ? String(outsideReason).trim() : undefined,
      };

      if (existingIdx !== -1) {
        const prev = sys.records[existingIdx];
        const updated: DailyAttendanceTimesheetRecord = {
          ...prev,
          recordType: 'ATTENDANCE',
          clockInTime: prev.clockInTime || nowIso,
          clockInLocation: prev.clockInLocation || clockInLoc,
          isOutsideWorkLocation: prev.isOutsideWorkLocation || isOutside,
          outsideLocationReason: isOutside
            ? String(outsideReason).trim()
            : prev.outsideLocationReason,
          outsideReviewStatus:
            prev.isOutsideWorkLocation || isOutside ? 'PENDING_HR_REVIEW' : 'NOT_REQUIRED',
          isFlextimeApplied: Boolean(activeFlex),
          flextimeRuleLabel: activeFlex?.scheduleArrangement,
          timesheetItems: newTimesheetItems,
          updatedAt: nowIso,
        };
        sys.records[existingIdx] = updated;
        createdOrUpdated = updated;
      } else {
        const fresh: DailyAttendanceTimesheetRecord = {
          id: `att-${targetDate}-${currentUser.id}`,
          date: targetDate,
          userId: currentUser.id,
          userName: currentUser.name,
          userRoleTitle: currentUser.roleTitle,
          department: currentUser.department,
          recordType: 'ATTENDANCE',
          clockInTime: nowIso,
          clockInLocation: clockInLoc,
          totalWorkHours: 0,
          isOutsideWorkLocation: isOutside,
          outsideLocationReason: isOutside ? String(outsideReason).trim() : undefined,
          outsideReviewStatus: isOutside ? 'PENDING_HR_REVIEW' : 'NOT_REQUIRED',
          isFlextimeApplied: Boolean(activeFlex),
          flextimeRuleLabel: activeFlex?.scheduleArrangement,
          timesheetItems: newTimesheetItems,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        sys.records.unshift(fresh);
        createdOrUpdated = fresh;
      }

      appendAttendanceAudit(
        draft,
        currentUser,
        isOutside ? 'OUTSIDE_LOCATION' : 'CLOCK_IN_OUT',
        isOutside ? 'Clock In (Outside Work Location)' : 'Clock In Harian',
        `${currentUser.name} melakukan Clock In pada ${targetDate} (${clockInLoc.locationLabel}). Pekerjaan Timesheet: ${newTimesheetItems
          .map((i) => i.category)
          .join(', ')}.`,
        currentUser.name
      );
    });

    if (errMsg) {
      return res.status(400).json({ error: errMsg });
    }
    res.json({ record: createdOrUpdated, bundle: db.getData().attendanceSystem });
  });

  // 1B. RESET PRESENSI HARI INI (Agar dapat melakukan Deteksi Kantor & Clock In ulang)
  app.post('/api/attendance-system/reset-today', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const { date }: { date?: string } = req.body || {};
    const targetDate =
      date && String(date).trim()
        ? String(date).trim()
        : new Date().toISOString().slice(0, 10);

    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      sys.records = sys.records.filter(
        (r) => !(r.userId === currentUser.id && r.date === targetDate)
      );
    });

    res.json({ bundle: db.getData().attendanceSystem });
  });

  // 3. UPDATE / TAMBAH PEKERJAAN DI TIMESHEET HARIAN (TERMASUK HARI WFA)
  app.post('/api/attendance-system/timesheet', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const {
      date,
      timesheetItems,
    }: {
      date?: string;
      timesheetItems: { id?: string; category: WijnaWorkCategory; shortDescription: string }[];
    } = req.body || {};

    const targetDate = date && String(date).trim() ? String(date).trim() : new Date().toISOString().slice(0, 10);
    if (!Array.isArray(timesheetItems) || timesheetItems.length === 0) {
      return res.status(400).json({ error: 'Timesheet harian harus memuat minimal 1 jenis pekerjaan.' });
    }

    let updatedRecord: DailyAttendanceTimesheetRecord | null = null;
    const nowIso = new Date().toISOString();

    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      const existingIdx = sys.records.findIndex(
        (r) => r.userId === currentUser.id && r.date === targetDate
      );

      const normalizedItems: TimesheetWorkItem[] = timesheetItems.slice(0, 2).map((item, idx) => ({
        id: item.id || `ts-${Date.now()}-${idx}`,
        category: item.category,
        shortDescription: String(item.shortDescription || item.category).trim(),
        createdAt: nowIso,
        updatedAt: nowIso,
      }));

      // Cek apakah tanggal tersebut adalah WFA yang aktif di kalender (single-day, multi-day, atau diajak kolaborasi WFA)
      const approvedWfa = sys.wfaRequests.find((w) => {
        const sDate = w.startDate || w.date;
        const eDate = w.endDate || sDate;
        const isParticipant =
          w.userId === currentUser.id ||
          (Array.isArray(w.invitedUserIds) && w.invitedUserIds.includes(currentUser.id));
        return (
          isParticipant &&
          isAttendanceArrangementActiveOnCalendar(w.status, w.workflowType) &&
          sDate <= targetDate &&
          eDate >= targetDate
        );
      });

      if (existingIdx !== -1) {
        const prev = sys.records[existingIdx];
        const nextRec: DailyAttendanceTimesheetRecord = {
          ...prev,
          recordType: approvedWfa ? 'WFA' : prev.recordType,
          totalWorkHours: approvedWfa
            ? sys.locationConfig.standardDailyHours
            : prev.totalWorkHours,
          wfaRequestId: approvedWfa?.id || prev.wfaRequestId,
          timesheetItems: normalizedItems,
          updatedAt: nowIso,
        };
        sys.records[existingIdx] = nextRec;
        updatedRecord = nextRec;
      } else {
        // Jika belum ada record (misalnya pada hari WFA), buat record WFA atau draft harian
        const fresh: DailyAttendanceTimesheetRecord = {
          id: `att-${targetDate}-${currentUser.id}`,
          date: targetDate,
          userId: currentUser.id,
          userName: currentUser.name,
          userRoleTitle: currentUser.roleTitle,
          department: currentUser.department,
          recordType: approvedWfa ? 'WFA' : 'ATTENDANCE',
          totalWorkHours: approvedWfa ? sys.locationConfig.standardDailyHours : 0,
          isOutsideWorkLocation: false,
          outsideReviewStatus: 'NOT_REQUIRED',
          isFlextimeApplied: false,
          wfaRequestId: approvedWfa?.id,
          timesheetItems: normalizedItems,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        sys.records.unshift(fresh);
        updatedRecord = fresh;
      }

      appendAttendanceAudit(
        draft,
        currentUser,
        'TIMESHEET',
        'Pembaruan Timesheet Harian',
        `${currentUser.name} memperbarui Timesheet tanggal ${targetDate} (${normalizedItems.length} item pekerjaan: ${normalizedItems
          .map((i) => i.category)
          .join(', ')}).`,
        currentUser.name
      );
    });

    res.json({ record: updatedRecord, bundle: db.getData().attendanceSystem });
  });

  // 4. CLOCK OUT & HITUNG OTOMATIS TOTAL JAM KERJA HARIAN
  app.post('/api/attendance-system/clock-out', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const {
      date,
      latitude,
      longitude,
      outsideReason,
    }: {
      date?: string;
      latitude: number;
      longitude: number;
      outsideReason?: string;
    } = req.body || {};

    const targetDate = date && String(date).trim() ? String(date).trim() : new Date().toISOString().slice(0, 10);
    const lat = Number(latitude);
    const lon = Number(longitude);
    const accuracyMargin = Math.min(200, Math.max(0, Math.round(Number(req.body?.gpsAccuracy) || 0)));
    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ error: 'Koordinat lokasi Clock Out tidak valid.' });
    }

    let updatedRecord: DailyAttendanceTimesheetRecord | null = null;
    let errMsg: string | null = null;

    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      const idx = sys.records.findIndex(
        (r) => r.userId === currentUser.id && r.date === targetDate
      );
      if (idx === -1 || !sys.records[idx].clockInTime) {
        errMsg = 'Anda belum melakukan Clock In pada tanggal ini.';
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
        errMsg = 'Clock Out dilakukan di luar area WIJNA (Outside Work Location). Mohon isi keterangan singkat.';
        return;
      }

      const nowIso = new Date().toISOString();
      const computedHours = Math.max(
        0.1,
        calculateWorkHoursBetween(prev.clockInTime!, nowIso)
      );

      const clockOutLoc = {
        latitude: lat,
        longitude: lon,
        distanceMeters,
        isOutsideWorkLocation: isOutside,
        locationLabel: isOutside
          ? `Outside Work Location (${lat.toFixed(4)}, ${lon.toFixed(4)} • ${distanceMeters}m)`
          : `${sys.locationConfig.officeName} (${distanceMeters}m)`,
        outsideReason: isOutside ? String(outsideReason || prev.outsideLocationReason || '').trim() : undefined,
      };

      const combinedOutside = prev.isOutsideWorkLocation || isOutside;
      const combinedReason = [
        prev.outsideLocationReason,
        isOutside && outsideReason ? String(outsideReason).trim() : '',
      ]
        .filter(Boolean)
        .join(' | ');

      const nextRec: DailyAttendanceTimesheetRecord = {
        ...prev,
        clockOutTime: nowIso,
        clockOutLocation: clockOutLoc,
        totalWorkHours: computedHours,
        isOutsideWorkLocation: combinedOutside,
        outsideLocationReason: combinedReason || prev.outsideLocationReason,
        outsideReviewStatus: combinedOutside
          ? prev.outsideReviewStatus === 'NOT_REQUIRED'
            ? 'PENDING_HR_REVIEW'
            : prev.outsideReviewStatus
          : 'NOT_REQUIRED',
        updatedAt: nowIso,
      };

      sys.records[idx] = nextRec;
      updatedRecord = nextRec;

      appendAttendanceAudit(
        draft,
        currentUser,
        isOutside ? 'OUTSIDE_LOCATION' : 'CLOCK_IN_OUT',
        isOutside ? 'Clock Out (Outside Work Location)' : 'Clock Out Harian',
        `${currentUser.name} melakukan Clock Out pada ${targetDate}. Total jam kerja: ${computedHours} jam (${clockOutLoc.locationLabel}).`,
        currentUser.name
      );
    });

    if (errMsg) {
      return res.status(400).json({ error: errMsg });
    }
    res.json({ record: updatedRecord, bundle: db.getData().attendanceSystem });
  });

  // 2. OUTSIDE WORK LOCATION WORKFLOW BERDASARKAN PERAN (EMPLOYEE->FINANCE, FINANCE->DIRECTOR, DIRECTOR->FINANCE)
  app.post('/api/attendance-system/outside-location-review', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const {
      recordId,
      stage,
      decision,
      notes,
    }: {
      recordId: string;
      stage: 'hr' | 'director';
      decision?: 'approve' | 'return' | 'review' | 'acknowledge';
      notes?: string;
    } = req.body || {};

    if (stage === 'hr' && !isHrAuthorized(currentUser)) {
      return res.status(403).json({ error: 'Hanya Finance/HR yang dapat memproses lokasi luar kantor.' });
    }
    if (stage === 'director' && !isDirectorAuthorized(currentUser)) {
      return res.status(403).json({ error: 'Hanya Director yang dapat memberikan review/masukan lokasi luar kantor.' });
    }

    if (decision === 'return' && (!notes || !String(notes).trim())) {
      return res.status(400).json({
        error: 'Pengembalian (Return) catatan wajib menyertakan alasan atau catatan klarifikasi dari Finance.',
      });
    }

    let updatedRecord: DailyAttendanceTimesheetRecord | null = null;
    const nowIso = new Date().toISOString();

    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      const idx = sys.records.findIndex((r) => r.id === recordId);
      if (idx === -1) return;

      const prev = sys.records[idx];
      const wf =
        prev.workflowType || resolveAttendanceWorkflowType(prev.userId, undefined, prev.userRoleTitle);

      if (stage === 'hr') {
        if (wf === 'DIRECTOR_TO_FINANCE_NOTIFY') {
          sys.records[idx] = {
            ...prev,
            workflowType: wf,
            outsideReviewStatus: 'ACKNOWLEDGED_BY_FINANCE',
            hrReviewByName: currentUser.name,
            hrReviewAt: nowIso,
            hrReviewNotes: notes
              ? String(notes).trim()
              : 'Informasi lokasi kehadiran Direktur telah dicatat oleh Finance.',
            updatedAt: nowIso,
          };
        } else if (decision === 'return') {
          sys.records[idx] = {
            ...prev,
            workflowType: wf,
            outsideReviewStatus: 'RETURNED_BY_FINANCE',
            hrReviewByName: currentUser.name,
            hrReviewAt: nowIso,
            returnReason: String(notes).trim(),
            hrReviewNotes: String(notes).trim(),
            updatedAt: nowIso,
          };
        } else {
          sys.records[idx] = {
            ...prev,
            workflowType: wf,
            outsideReviewStatus: 'HR_REVIEWED',
            hrReviewByName: currentUser.name,
            hrReviewAt: nowIso,
            hrReviewNotes: notes ? String(notes).trim() : 'Approved oleh Finance.',
            updatedAt: nowIso,
          };
        }
      } else {
        sys.records[idx] = {
          ...prev,
          workflowType: wf,
          outsideReviewStatus:
            wf === 'FINANCE_TO_DIRECTOR_REVIEW' ? 'REVIEWED_BY_DIRECTOR' : 'DIRECTOR_ACKNOWLEDGED',
          directorAckByName: currentUser.name,
          directorAckAt: nowIso,
          directorAckNotes: notes
            ? String(notes).trim()
            : 'Direview oleh Director untuk pengawasan & masukan strategis.',
          updatedAt: nowIso,
        };
      }

      updatedRecord = sys.records[idx];
      appendAttendanceAudit(
        draft,
        currentUser,
        'OUTSIDE_LOCATION',
        stage === 'hr'
          ? decision === 'return'
            ? 'Pengembalian (Returned) Outside Work Location oleh Finance'
            : wf === 'DIRECTOR_TO_FINANCE_NOTIFY'
            ? 'Pencatatan Informasi Outside Work Location Direktur oleh Finance'
            : 'Persetujuan (Approved) Outside Work Location oleh Finance'
          : 'Catatan Review Outside Work Location oleh Director',
        `${currentUser.name} memproses catatan Outside Work Location milik ${prev.userName} tanggal ${prev.date}. Catatan: ${
          notes || '-'
        }`,
        prev.userName
      );
    });

    if (!updatedRecord) {
      return res.status(404).json({ error: 'Catatan kehadiran tidak ditemukan.' });
    }
    res.json({ record: updatedRecord, bundle: db.getData().attendanceSystem });
  });

  // PENGATURAN LOKASI REFERENSI WIJNA HANYA OLEH DIREKTUR
  app.put('/api/attendance-system/location-config', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (!isDirectorAuthorized(currentUser)) {
      return res.status(403).json({ error: 'Hanya Direktur yang dapat menentukan titik koordinat lokasi dan radius kerja WIJNA.' });
    }

    const { officeName, address, latitude, longitude, radiusMeters, standardDailyHours } = req.body || {};
    const nowIso = new Date().toISOString();

    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      sys.locationConfig = {
        officeName: officeName ? String(officeName).trim() : sys.locationConfig.officeName,
        address: address ? String(address).trim() : sys.locationConfig.address,
        latitude: !isNaN(Number(latitude)) ? Number(latitude) : sys.locationConfig.latitude,
        longitude: !isNaN(Number(longitude)) ? Number(longitude) : sys.locationConfig.longitude,
        radiusMeters: !isNaN(Number(radiusMeters)) ? Math.max(1, Number(radiusMeters)) : sys.locationConfig.radiusMeters,
        standardDailyHours: !isNaN(Number(standardDailyHours))
          ? Math.max(1, Number(standardDailyHours))
          : sys.locationConfig.standardDailyHours,
        updatedByName: currentUser.name,
        updatedAt: nowIso,
      };

      appendAttendanceAudit(
        draft,
        currentUser,
        'POLICY',
        'Penentuan Titik Koordinat Lokasi Kerja WIJNA oleh Direktur',
        `Direktur (${currentUser.name}) menentukan titik koordinat lokasi kerja "${sys.locationConfig.officeName}" (${sys.locationConfig.latitude}, ${sys.locationConfig.longitude}, radius ${sys.locationConfig.radiusMeters}m).`
      );
    });

    res.json({ bundle: db.getData().attendanceSystem });
  });

  // 5. FLEXTIME — WORKFLOW BERDASARKAN PERAN (EMPLOYEE->FINANCE, FINANCE->DIRECTOR, DIRECTOR->FINANCE)
  app.post('/api/attendance-system/flextime', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const {
      id,
      userId,
      startDate,
      endDate,
      scheduleArrangement,
      policyNotes,
      isActive,
      mode,
    } = req.body || {};

    const isStaffRequest =
      mode === 'staff_request' ||
      (!isHrAuthorized(currentUser) && !isDirectorAuthorized(currentUser));
    const resolvedUserId = isStaffRequest ? currentUser.id : userId || currentUser.id;

    if (!resolvedUserId || !startDate || !endDate || !scheduleArrangement) {
      return res
        .status(400)
        .json({ error: 'Staf, periode tanggal, dan pengaturan jadwal Flextime wajib diisi.' });
    }

    const nowIso = new Date().toISOString();
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      const targetUser = draft.users.find((u) => u.id === resolvedUserId) || currentUser;
      const userName = targetUser?.name || currentUser.name;
      const userRoleTitle = targetUser?.roleTitle || currentUser.roleTitle;
      const wf = resolveAttendanceWorkflowType(targetUser?.id, targetUser?.role, userRoleTitle);

      if (id && (isHrAuthorized(currentUser) || isDirectorAuthorized(currentUser))) {
        const idx = sys.flextimeAssignments.findIndex((f) => f.id === id);
        if (idx !== -1) {
          const nextActive = isActive !== undefined ? Boolean(isActive) : true;
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
            policyNotes: String(policyNotes || '').trim(),
            isActive: nextActive,
            status:
              wf === 'DIRECTOR_TO_FINANCE_NOTIFY'
                ? 'Notified to Finance'
                : wf === 'FINANCE_TO_DIRECTOR_REVIEW'
                ? 'Submitted for Review'
                : nextActive
                ? 'Approved'
                : sys.flextimeAssignments[idx].status || 'Approved',
            assignedById: currentUser.id,
            assignedByName: currentUser.name,
            updatedAt: nowIso,
          };
        }
      } else {
        // Tentukan status awal sesuai workflow peran
        const isDirectHrForEmployee =
          !isStaffRequest &&
          isHrAuthorized(currentUser) &&
          wf === 'EMPLOYEE_TO_FINANCE_APPROVAL';
        const initialStatus =
          wf === 'DIRECTOR_TO_FINANCE_NOTIFY'
            ? 'Notified to Finance'
            : wf === 'FINANCE_TO_DIRECTOR_REVIEW'
            ? 'Submitted for Review'
            : isDirectHrForEmployee
            ? 'Approved'
            : 'Pending';

        const activeOnCalendar = isAttendanceArrangementActiveOnCalendar(initialStatus, wf);

        const newFlex: FlextimeAssignment = {
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
          policyNotes: String(policyNotes || '').trim(),
          assignedById: currentUser.id,
          assignedByName:
            wf === 'DIRECTOR_TO_FINANCE_NOTIFY'
              ? `${currentUser.name} (Director → Finance: Notify for Information)`
              : wf === 'FINANCE_TO_DIRECTOR_REVIEW'
              ? `${currentUser.name} (Finance → Director: Submit for Review)`
              : isDirectHrForEmployee
              ? `${currentUser.name} (Finance)`
              : `${currentUser.name} (Employee → Finance: Submit for Approval)`,
          reviewedByName: isDirectHrForEmployee ? currentUser.name : undefined,
          reviewedAt: isDirectHrForEmployee ? nowIso : undefined,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        sys.flextimeAssignments.unshift(newFlex);

        if (activeOnCalendar) {
          for (let i = 0; i < sys.records.length; i++) {
            const rec = sys.records[i];
            if (
              rec.userId === resolvedUserId &&
              rec.recordType === 'ATTENDANCE' &&
              rec.date >= startDate &&
              rec.date <= endDate
            ) {
              sys.records[i] = {
                ...rec,
                isFlextimeApplied: true,
                flextimeRuleLabel: newFlex.scheduleArrangement,
                updatedAt: nowIso,
              };
            }
          }
        }
      }

      appendAttendanceAudit(
        draft,
        currentUser,
        'FLEXTIME',
        wf === 'DIRECTOR_TO_FINANCE_NOTIFY'
          ? 'Pemberitahuan Flextime Director ke Finance (Notify for Information)'
          : wf === 'FINANCE_TO_DIRECTOR_REVIEW'
          ? 'Pengajuan Review Flextime Finance ke Director (Submit for Review)'
          : isStaffRequest
          ? 'Pengajuan Flextime oleh Staf ke Finance (Submit for Approval)'
          : 'Pengaturan Flextime oleh Finance',
        `${currentUser.name} mengatur/mengajukan Flextime untuk ${userName} periode ${startDate} s/d ${endDate}: "${scheduleArrangement}".`,
        userName
      );
    });

    res.json({ bundle: db.getData().attendanceSystem });
  });

  app.post('/api/attendance-system/flextime/:id/decision', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (!isHrAuthorized(currentUser) && !isDirectorAuthorized(currentUser)) {
      return res
        .status(403)
        .json({ error: 'Hanya Finance atau Director yang dapat memproses Flextime.' });
    }
    const { id } = req.params;
    const {
      decision,
      notes,
    }: {
      decision: 'approve' | 'return' | 'reject' | 'review' | 'acknowledge';
      notes?: string;
    } = req.body || {};

    if ((decision === 'return' || decision === 'reject') && (!notes || !String(notes).trim())) {
      return res.status(400).json({
        error: 'Pengembalian (Return) pengajuan wajib menyertakan alasan atau catatan klarifikasi yang jelas dari Finance.',
      });
    }

    const nowIso = new Date().toISOString();
    let errMsg: string | null = null;

    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      const idx = sys.flextimeAssignments.findIndex((f) => f.id === id);
      if (idx === -1) return;

      const prev = sys.flextimeAssignments[idx];
      const wf =
        prev.workflowType || resolveAttendanceWorkflowType(prev.userId, undefined, prev.userRoleTitle);

      if (wf === 'DIRECTOR_TO_FINANCE_NOTIFY') {
        if (!isHrAuthorized(currentUser)) {
          errMsg = 'Hanya Finance yang mencatat pemberitahuan (Acknowledge) dari Director.';
          return;
        }
        sys.flextimeAssignments[idx] = {
          ...prev,
          workflowType: wf,
          isActive: true,
          status: 'Acknowledged by Finance',
          financeAcknowledgedByName: currentUser.name,
          financeAcknowledgedAt: nowIso,
          financeAckNotes: notes
            ? String(notes).trim()
            : 'Informasi jadwal Flextime Director telah dicatat oleh Finance.',
          updatedAt: nowIso,
        };
      } else if (wf === 'FINANCE_TO_DIRECTOR_REVIEW') {
        if (!isDirectorAuthorized(currentUser)) {
          errMsg = 'Pengajuan dari Finance direview oleh Director untuk masukan strategis.';
          return;
        }
        sys.flextimeAssignments[idx] = {
          ...prev,
          workflowType: wf,
          isActive: true,
          status: 'Reviewed by Director',
          directorReviewedByName: currentUser.name,
          directorReviewedAt: nowIso,
          directorReviewNotes: notes
            ? String(notes).trim()
            : 'Telah direview oleh Director (tanpa keberatan).',
          updatedAt: nowIso,
        };
      } else {
        // EMPLOYEE_TO_FINANCE_APPROVAL
        if (!isHrAuthorized(currentUser)) {
          errMsg = 'Pengajuan staf (Employee → Finance) disetujui atau dikembalikan oleh Finance.';
          return;
        }
        const isApproved = decision === 'approve';
        const reasonText = notes ? String(notes).trim() : '';
        sys.flextimeAssignments[idx] = {
          ...prev,
          workflowType: wf,
          isActive: isApproved,
          status: isApproved ? 'Approved' : 'Returned',
          reviewedByName: currentUser.name,
          reviewedAt: nowIso,
          returnReason: !isApproved ? reasonText : undefined,
          reviewNotes:
            reasonText ||
            (isApproved
              ? 'Approved oleh Finance & disinkronkan ke kalender.'
              : 'Returned oleh Finance untuk revisi/klarifikasi.'),
          updatedAt: nowIso,
        };

        if (isApproved) {
          for (let i = 0; i < sys.records.length; i++) {
            const rec = sys.records[i];
            if (
              rec.userId === prev.userId &&
              rec.recordType === 'ATTENDANCE' &&
              rec.date >= prev.startDate &&
              rec.date <= prev.endDate
            ) {
              sys.records[i] = {
                ...rec,
                isFlextimeApplied: true,
                flextimeRuleLabel: prev.scheduleArrangement,
                updatedAt: nowIso,
              };
            }
          }
        }
      }

      appendAttendanceAudit(
        draft,
        currentUser,
        'FLEXTIME',
        `Pemrosesan Flextime (${sys.flextimeAssignments[idx].status})`,
        `${currentUser.name} memproses Flextime milik ${prev.userName} (${prev.startDate} s/d ${prev.endDate}). Catatan: ${notes || '-'}`,
        prev.userName
      );
    });

    if (errMsg) {
      return res.status(403).json({ error: errMsg });
    }
    res.json({ bundle: db.getData().attendanceSystem });
  });

  app.delete('/api/attendance-system/flextime/:id', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (!isHrAuthorized(currentUser)) {
      return res.status(403).json({ error: 'Hanya HR yang dapat menghapus atau menonaktifkan pengaturan Flextime.' });
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
        'FLEXTIME',
        'Penghapusan Periode Flextime oleh HR',
        `HR (${currentUser.name}) menghapus pengaturan Flextime milik ${target.userName} (${target.startDate} s/d ${target.endDate}).`,
        target.userName
      );
    });
    res.json({ bundle: db.getData().attendanceSystem });
  });

  // 6. KATEGORI CUTI & IZIN (DIKELOLA OLEH HR) + PENGAJUAN & KEPUTUSAN MANUAL DIRECTOR
  app.post('/api/attendance-system/leave-policies', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (!isHrAuthorized(currentUser)) {
      return res.status(403).json({ error: 'Kategori dan kuota cuti hanya dapat dikelola oleh HR.' });
    }

    const {
      id,
      code,
      name,
      group,
      allocationDaysPerYear,
      requiresAttachmentOrNote,
      termsAndProvisions,
      isActive,
    } = req.body || {};

    if (!name || !group) {
      return res.status(400).json({ error: 'Nama kategori cuti dan kelompok cuti wajib diisi.' });
    }

    const nowIso = new Date().toISOString();
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      if (id) {
        const idx = sys.leavePolicies.findIndex((p) => p.id === id);
        if (idx !== -1) {
          sys.leavePolicies[idx] = {
            ...sys.leavePolicies[idx],
            code: code ? String(code).trim() : sys.leavePolicies[idx].code,
            name: String(name).trim(),
            group: group as LeaveCategoryGroup,
            allocationDaysPerYear: Math.max(0, Number(allocationDaysPerYear) || 0),
            requiresAttachmentOrNote: Boolean(requiresAttachmentOrNote),
            termsAndProvisions: String(termsAndProvisions || '').trim(),
            isActive: isActive !== undefined ? Boolean(isActive) : true,
            updatedByName: currentUser.name,
            updatedAt: nowIso,
          };
        }
      } else {
        const newPol: LeaveCategoryPolicy = {
          id: `leave-pol-${Date.now()}`,
          code: code ? String(code).trim() : `CT-${sys.leavePolicies.length + 1}`,
          name: String(name).trim(),
          group: group as LeaveCategoryGroup,
          allocationDaysPerYear: Math.max(0, Number(allocationDaysPerYear) || 0),
          requiresAttachmentOrNote: Boolean(requiresAttachmentOrNote),
          termsAndProvisions: String(termsAndProvisions || '').trim(),
          isActive: true,
          updatedByName: currentUser.name,
          updatedAt: nowIso,
        };
        sys.leavePolicies.push(newPol);
      }

      appendAttendanceAudit(
        draft,
        currentUser,
        'LEAVE',
        id ? 'Pembaruan Kebijakan Kategori Cuti oleh HR' : 'Penambahan Kategori Cuti Baru oleh HR',
        `HR (${currentUser.name}) mengatur kategori cuti "${name}" (Alokasi: ${allocationDaysPerYear} hari/tahun).`
      );
    });

    res.json({ bundle: db.getData().attendanceSystem });
  });

  app.delete('/api/attendance-system/leave-policies/:id', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (!isHrAuthorized(currentUser)) {
      return res.status(403).json({ error: 'Hanya Finance/HR yang dapat menghapus kategori cuti.' });
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
        'LEAVE',
        'Penghapusan Kategori Cuti oleh Finance/HR',
        `Finance/HR (${currentUser.name}) menghapus kategori cuti "${target.name}" (${target.code}).`
      );
    });
    res.json({ bundle: db.getData().attendanceSystem });
  });

  app.post('/api/attendance-system/leave-requests', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const { categoryId, startDate, endDate, reason } = req.body || {};

    if (!categoryId || !startDate || !endDate) {
      return res.status(400).json({ error: 'Pilih jenis cuti/izin dan rentang tanggal.' });
    }

    const nowIso = new Date().toISOString();
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      const pol = sys.leavePolicies.find((p) => p.id === categoryId) || sys.leavePolicies[0];
      const diffDays = calculateWorkingDaysBetween(startDate, endDate);
      const wf = resolveAttendanceWorkflowType(
        currentUser.id,
        currentUser.role,
        currentUser.roleTitle
      );

      // Tentukan status awal berdasarkan peran pengguna:
      // 1. Employee -> Finance: 'Pending' (Submit for Approval)
      // 2. Finance -> Director: 'Submitted for Review' (Submit for Review & Strategic Input)
      // 3. Director -> Finance: 'Notified to Finance' (Notify for Information)
      const initialStatus =
        wf === 'DIRECTOR_TO_FINANCE_NOTIFY'
          ? 'Notified to Finance'
          : wf === 'FINANCE_TO_DIRECTOR_REVIEW'
          ? 'Submitted for Review'
          : 'Pending';

      const reqItem: LeaveRequestRecord = {
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
        reason: reason ? String(reason).trim() : '',
        status: initialStatus,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      sys.leaveRequests.unshift(reqItem);

      // Jika pengajuan dari Finance (Submit for Review) atau Director (Notify for Information),
      // otomatis sinkronkan ke kalender dan catatan kehadiran
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
              recordType: 'LEAVE',
              workflowType: wf,
              totalWorkHours: 0,
              isOutsideWorkLocation: false,
              outsideReviewStatus: 'NOT_REQUIRED',
              isFlextimeApplied: false,
              leaveRequestId: reqItem.id,
              leaveCategoryName: pol.name,
              timesheetItems: [],
              createdAt: nowIso,
              updatedAt: nowIso,
            });
          } else if (!sys.records[recIdx].clockInTime) {
            sys.records[recIdx] = {
              ...sys.records[recIdx],
              recordType: 'LEAVE',
              workflowType: wf,
              totalWorkHours: 0,
              leaveRequestId: reqItem.id,
              leaveCategoryName: pol.name,
              updatedAt: nowIso,
            };
          }
        }
      }

      appendAttendanceAudit(
        draft,
        currentUser,
        'LEAVE',
        wf === 'DIRECTOR_TO_FINANCE_NOTIFY'
          ? 'Pemberitahuan Cuti / Izin Director ke Finance (Notify for Information)'
          : wf === 'FINANCE_TO_DIRECTOR_REVIEW'
          ? 'Pengajuan Review Cuti / Izin Finance ke Director (Submit for Review)'
          : 'Pengajuan Cuti / Izin Staf ke Finance (Submit for Approval)',
        `${currentUser.name} (${
          wf === 'DIRECTOR_TO_FINANCE_NOTIFY'
            ? 'Director → Finance'
            : wf === 'FINANCE_TO_DIRECTOR_REVIEW'
            ? 'Finance → Director'
            : 'Employee → Finance'
        }) mencatat ${pol.name} (${startDate} s/d ${endDate}, ${diffDays} hari kerja).`,
        currentUser.name
      );
    });

    res.json({ bundle: db.getData().attendanceSystem });
  });

  app.post('/api/attendance-system/leave-requests/:id/decision', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const {
      stage,
      decision,
      notes,
    }: {
      stage?: 'hr' | 'director';
      decision: 'approve' | 'return' | 'reject' | 'review' | 'acknowledge';
      notes?: string;
    } = req.body || {};

    if ((decision === 'return' || decision === 'reject') && (!notes || !String(notes).trim())) {
      return res.status(400).json({
        error: 'Pengembalian (Return) pengajuan cuti/izin wajib menyertakan alasan atau catatan klarifikasi yang jelas dari Finance.',
      });
    }

    const nowIso = new Date().toISOString();
    let errMsg: string | null = null;

    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      const idx = sys.leaveRequests.findIndex((l) => l.id === id);
      if (idx === -1) return;

      const prev = sys.leaveRequests[idx];
      const wf =
        prev.workflowType || resolveAttendanceWorkflowType(prev.userId, undefined, prev.userRoleTitle);

      if (wf === 'DIRECTOR_TO_FINANCE_NOTIFY') {
        // 3. Director -> Finance: Notification & Information only (Finance Acknowledges)
        if (!isHrAuthorized(currentUser)) {
          errMsg = 'Hanya Finance yang mencatat pemberitahuan (Acknowledge) kehadiran/cuti dari Director.';
          return;
        }
        sys.leaveRequests[idx] = {
          ...prev,
          workflowType: wf,
          status: 'Acknowledged by Finance',
          financeAcknowledgedByName: currentUser.name,
          financeAcknowledgedAt: nowIso,
          financeAckNotes: notes
            ? String(notes).trim()
            : 'Informasi kehadiran/cuti Director telah dicatat oleh Finance untuk administrasi.',
          updatedAt: nowIso,
        };
      } else if (wf === 'FINANCE_TO_DIRECTOR_REVIEW') {
        // 2. Finance -> Director: Submit for Review (Director provides strategic input/feedback only, no approve/return)
        if (!isDirectorAuthorized(currentUser)) {
          errMsg = 'Hanya Director yang dapat memberikan review & masukan strategis atas pengajuan Finance.';
          return;
        }
        sys.leaveRequests[idx] = {
          ...prev,
          workflowType: wf,
          status: 'Reviewed by Director',
          directorDecisionByName: currentUser.name,
          directorDecisionAt: nowIso,
          directorDecisionNotes: notes
            ? String(notes).trim()
            : 'Telah direview oleh Director (pengawasan & masukan strategis tercatat).',
          updatedAt: nowIso,
        };
      } else {
        // 1. Employee -> Finance: Submit for Approval (Finance Approves or Returns with mandatory reason)
        if (!isHrAuthorized(currentUser) && !(stage === 'director' && isDirectorAuthorized(currentUser))) {
          errMsg = 'Hanya Finance yang berwenang menyetujui (Approve) atau mengembalikan (Return) pengajuan staf.';
          return;
        }
        const isApproved = decision === 'approve';
        const reasonText = notes ? String(notes).trim() : '';

        sys.leaveRequests[idx] = {
          ...prev,
          workflowType: wf,
          status: isApproved ? 'Approved' : 'Returned',
          hrReviewerName: currentUser.name,
          hrReviewedAt: nowIso,
          returnReason: !isApproved ? reasonText : undefined,
          hrReviewNotes:
            reasonText ||
            (isApproved
              ? 'Approved oleh Finance. Otomatis tersinkronisasi ke Attendance & Team Calendar.'
              : 'Returned oleh Finance untuk revisi atau klarifikasi.'),
          updatedAt: nowIso,
        };

        // Sinkronisasi kalender & catatan harian ketika cuti disetujui oleh Finance
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
                recordType: 'LEAVE',
                workflowType: wf,
                totalWorkHours: 0,
                isOutsideWorkLocation: false,
                outsideReviewStatus: 'NOT_REQUIRED',
                isFlextimeApplied: false,
                leaveRequestId: prev.id,
                leaveCategoryName: prev.categoryName,
                timesheetItems: [],
                createdAt: nowIso,
                updatedAt: nowIso,
              });
            } else if (!sys.records[recIdx].clockInTime) {
              sys.records[recIdx] = {
                ...sys.records[recIdx],
                recordType: 'LEAVE',
                workflowType: wf,
                totalWorkHours: 0,
                leaveRequestId: prev.id,
                leaveCategoryName: prev.categoryName,
                updatedAt: nowIso,
              };
            }
          }
        }
      }

      appendAttendanceAudit(
        draft,
        currentUser,
        'LEAVE',
        `Pemrosesan Cuti / Izin (${sys.leaveRequests[idx].status})`,
        `${currentUser.name} memproses ${prev.categoryName} milik ${prev.userName} (${prev.startDate} s/d ${prev.endDate}). Status: ${sys.leaveRequests[idx].status}. Catatan: ${
          notes || '-'
        }`,
        prev.userName
      );
    });

    if (errMsg) {
      return res.status(403).json({ error: errMsg });
    }
    res.json({ bundle: db.getData().attendanceSystem });
  });

  // 7. WORK FROM ANYWHERE (WFA) — WORKFLOW BERDASARKAN PERAN (EMPLOYEE->FINANCE, FINANCE->DIRECTOR, DIRECTOR->FINANCE)
  app.post('/api/attendance-system/wfa', (req: Request, res: Response) => {
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
      invitedUserIds,
    }: {
      mode: 'staff_request' | 'hr_manual';
      userId?: string;
      date?: string;
      startDate?: string;
      endDate?: string;
      reasonAndPlan: string;
      hrNotes?: string;
      torId?: string;
      torNumber?: string;
      torTitle?: string;
      implementationOption?: string;
      isCustomImplementation?: boolean;
      invitedUserIds?: string[];
    } = req.body || {};

    const resolvedStart = String(startDate || date || '').trim();
    const resolvedEnd = String(endDate || resolvedStart || '').trim();

    if (!resolvedStart || !reasonAndPlan) {
      return res.status(400).json({ error: 'Tanggal WFA dan rencana pekerjaan harian wajib diisi.' });
    }

    if (mode === 'hr_manual' && !isHrAuthorized(currentUser)) {
      return res.status(403).json({ error: 'Hanya Finance/HR yang dapat memasukkan status WFA secara manual untuk staf.' });
    }

    const nowIso = new Date().toISOString();
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      const targetUser =
        mode === 'hr_manual' && userId
          ? draft.users.find((u) => u.id === userId) || currentUser
          : currentUser;

      const cleanInvitedIds = Array.isArray(invitedUserIds)
        ? Array.from(
            new Set(
              invitedUserIds
                .map((id) => String(id).trim())
                .filter((id) => id && id !== targetUser.id)
            )
          )
        : [];
      const invitedUsers = cleanInvitedIds
        .map((id) => draft.users.find((u) => u.id === id))
        .filter((u): u is User => Boolean(u));
      const resolvedInvitedIds = invitedUsers.map((u) => u.id);
      const resolvedInvitedNames = invitedUsers.map((u) => u.name);

      const wf = resolveAttendanceWorkflowType(
        targetUser.id,
        targetUser.role,
        targetUser.roleTitle
      );
      const isHrDirectForEmployee =
        mode === 'hr_manual' && wf === 'EMPLOYEE_TO_FINANCE_APPROVAL';

      // Tentukan status berdasarkan alur kerja peran:
      // - Director -> Finance: 'Notified to Finance' (langsung aktif di kalender, notifikasi informasi ke Finance)
      // - Finance -> Director: 'Submitted for Review' (langsung aktif di kalender, diajukan ke Director untuk review/masukan)
      // - Employee -> Finance: 'Pending' (atau 'Approved' jika dimasukkan manual oleh Finance)
      const initialStatus =
        wf === 'DIRECTOR_TO_FINANCE_NOTIFY'
          ? 'Notified to Finance'
          : wf === 'FINANCE_TO_DIRECTOR_REVIEW'
          ? 'Submitted for Review'
          : isHrDirectForEmployee
          ? 'Approved'
          : 'Pending';

      const totalDays = calculateWorkingDaysBetween(resolvedStart, resolvedEnd);
      const wfaItem: WfaRequestRecord = {
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
        torId: torId ? String(torId).trim() : undefined,
        torNumber: torNumber ? String(torNumber).trim() : undefined,
        torTitle: torTitle ? String(torTitle).trim() : undefined,
        implementationOption: implementationOption ? String(implementationOption).trim() : undefined,
        isCustomImplementation: Boolean(isCustomImplementation),
        invitedUserIds: resolvedInvitedIds.length > 0 ? resolvedInvitedIds : undefined,
        invitedUserNames: resolvedInvitedNames.length > 0 ? resolvedInvitedNames : undefined,
        status: initialStatus,
        enteredManuallyByHr: isHrDirectForEmployee,
        hrManagedByName: isHrDirectForEmployee ? currentUser.name : undefined,
        hrManagedAt: isHrDirectForEmployee ? nowIso : undefined,
        hrNotes: isHrDirectForEmployee
          ? String(hrNotes || 'Status WFA dimasukkan & disetujui oleh Finance.').trim()
          : undefined,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      sys.wfaRequests.unshift(wfaItem);

      // Jika aktif di kalender (Approved, Submitted for Review, atau Notified to Finance), otomatis sinkronkan ke records (termasuk staf yang diajak)
      if (isAttendanceArrangementActiveOnCalendar(initialStatus, wf)) {
        const targetDates = enumerateDatesBetween(resolvedStart, resolvedEnd, true);
        const participantsToSync = [targetUser, ...invitedUsers];
        for (const pUser of participantsToSync) {
          for (const dStr of targetDates) {
            const existingRecIdx = sys.records.findIndex(
              (r) => r.userId === pUser.id && r.date === dStr
            );
            const descForParticipant =
              pUser.id === targetUser.id
                ? String(reasonAndPlan).trim()
                : `${String(reasonAndPlan).trim()} (Kolaborasi WFA bersama ${targetUser.name})`;
            if (existingRecIdx === -1) {
              sys.records.unshift({
                id: `att-${dStr}-${pUser.id}`,
                date: dStr,
                userId: pUser.id,
                userName: pUser.name,
                userRoleTitle: pUser.roleTitle,
                department: pUser.department,
                recordType: 'WFA',
                workflowType: wf,
                totalWorkHours: sys.locationConfig.standardDailyHours,
                isOutsideWorkLocation: false,
                outsideReviewStatus: 'NOT_REQUIRED',
                isFlextimeApplied: false,
                wfaRequestId: wfaItem.id,
                timesheetItems: [
                  {
                    id: `ts-wfa-${Date.now()}-${dStr}-${pUser.id}`,
                    category: 'Perencanaan & Pengembangan',
                    shortDescription: descForParticipant,
                    createdAt: nowIso,
                  },
                ],
                createdAt: nowIso,
                updatedAt: nowIso,
              });
            } else if (!sys.records[existingRecIdx].clockInTime) {
              sys.records[existingRecIdx] = {
                ...sys.records[existingRecIdx],
                recordType: 'WFA',
                workflowType: wf,
                totalWorkHours: sys.locationConfig.standardDailyHours,
                wfaRequestId: wfaItem.id,
                timesheetItems:
                  sys.records[existingRecIdx].timesheetItems.length > 0
                    ? sys.records[existingRecIdx].timesheetItems
                    : [
                        {
                          id: `ts-wfa-${Date.now()}-${dStr}-${pUser.id}`,
                          category: 'Perencanaan & Pengembangan',
                          shortDescription: descForParticipant,
                          createdAt: nowIso,
                        },
                      ],
                updatedAt: nowIso,
              };
            }
          }
        }
      }

      const rangeLabel =
        resolvedStart === resolvedEnd
          ? resolvedStart
          : `${resolvedStart} s/d ${resolvedEnd} (${totalDays} hari kerja)`;
      const invitedSuffix =
        resolvedInvitedNames.length > 0
          ? ` (Mengajak staf: ${resolvedInvitedNames.join(', ')})`
          : '';
      appendAttendanceAudit(
        draft,
        currentUser,
        'WFA',
        wf === 'DIRECTOR_TO_FINANCE_NOTIFY'
          ? 'Pemberitahuan WFA Director ke Finance (Notify for Information)'
          : wf === 'FINANCE_TO_DIRECTOR_REVIEW'
          ? 'Pengajuan Review WFA Finance ke Director (Submit for Review)'
          : isHrDirectForEmployee
          ? 'Penetapan WFA Staf oleh Finance (Approved)'
          : 'Pengajuan WFA Staf ke Finance (Submit for Approval)',
        `${currentUser.name} mencatat WFA untuk ${targetUser.name}${invitedSuffix} pada tanggal ${rangeLabel}: "${reasonAndPlan}".`,
        targetUser.name
      );
    });

    res.json({ bundle: db.getData().attendanceSystem });
  });

  app.post('/api/attendance-system/wfa/:id/decision', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const { id } = req.params;
    const {
      stage,
      status,
      decision,
      notes,
    }: {
      stage?: 'hr' | 'director';
      status?: string;
      decision?: 'approve' | 'return' | 'reject' | 'review' | 'acknowledge';
      notes?: string;
    } = req.body || {};

    const isReturning =
      decision === 'return' ||
      decision === 'reject' ||
      status === 'Returned' ||
      status === 'Ditolak HR';

    if (isReturning && (!notes || !String(notes).trim())) {
      return res.status(400).json({
        error: 'Pengembalian (Return) pengajuan WFA wajib menyertakan alasan atau catatan klarifikasi yang jelas dari Finance.',
      });
    }

    const nowIso = new Date().toISOString();
    let errMsg: string | null = null;

    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      const idx = sys.wfaRequests.findIndex((w) => w.id === id);
      if (idx === -1) return;

      const prev = sys.wfaRequests[idx];
      const sDate = prev.startDate || prev.date;
      const eDate = prev.endDate || sDate;
      const wf =
        prev.workflowType || resolveAttendanceWorkflowType(prev.userId, undefined, prev.userRoleTitle);

      if (wf === 'DIRECTOR_TO_FINANCE_NOTIFY') {
        // 3. Director -> Finance: Notification only (Finance acknowledges for record-keeping)
        if (!isHrAuthorized(currentUser)) {
          errMsg = 'Hanya Finance yang mencatat pemberitahuan (Acknowledge) jadwal WFA Director.';
          return;
        }
        sys.wfaRequests[idx] = {
          ...prev,
          workflowType: wf,
          status: 'Acknowledged by Finance',
          financeAcknowledgedByName: currentUser.name,
          financeAcknowledgedAt: nowIso,
          financeAckNotes: notes
            ? String(notes).trim()
            : 'Informasi jadwal WFA Director telah dicatat oleh Finance.',
          updatedAt: nowIso,
        };
      } else if (wf === 'FINANCE_TO_DIRECTOR_REVIEW') {
        // 2. Finance -> Director: Submit for Review (Director provides strategic input/feedback only, no approve/return)
        if (!isDirectorAuthorized(currentUser)) {
          errMsg = 'Hanya Director yang dapat memberikan review & masukan strategis atas WFA Finance.';
          return;
        }
        sys.wfaRequests[idx] = {
          ...prev,
          workflowType: wf,
          status: 'Reviewed by Director',
          directorAcknowledgedByName: currentUser.name,
          directorAcknowledgedAt: nowIso,
          directorReviewNotes: notes
            ? String(notes).trim()
            : 'Telah direview oleh Director (pengawasan & masukan strategis tercatat).',
          updatedAt: nowIso,
        };
      } else {
        // 1. Employee -> Finance: Submit for Approval (Finance approves or returns with mandatory reason)
        if (!isHrAuthorized(currentUser)) {
          errMsg = 'Hanya Finance yang berwenang menyetujui (Approve) atau mengembalikan (Return) pengajuan WFA staf.';
          return;
        }
        const isApproved = !isReturning;
        const nextStatus = isApproved ? 'Approved' : 'Returned';
        const noteText = notes ? String(notes).trim() : '';

        sys.wfaRequests[idx] = {
          ...prev,
          workflowType: wf,
          status: nextStatus,
          hrManagedByName: currentUser.name,
          hrManagedAt: nowIso,
          returnReason: !isApproved ? noteText : undefined,
          hrNotes:
            noteText ||
            (isApproved
              ? 'Approved oleh Finance & disinkronkan ke Attendance dan Team Calendar.'
              : 'Returned oleh Finance untuk revisi/klarifikasi.'),
          updatedAt: nowIso,
        };

        if (isApproved) {
          const targetDates = enumerateDatesBetween(sDate, eDate, true);
          const ownerUser = draft.users.find((u) => u.id === prev.userId) || {
            id: prev.userId,
            name: prev.userName,
            roleTitle: prev.userRoleTitle,
            department: prev.department,
          };
          const invitedUsersList = (prev.invitedUserIds || [])
            .map((invId) => draft.users.find((u) => u.id === invId))
            .filter((u): u is User => Boolean(u));
          const participantsToSync = [ownerUser, ...invitedUsersList];

          for (const pUser of participantsToSync) {
            const descForParticipant =
              pUser.id === prev.userId
                ? prev.reasonAndPlan
                : `${prev.reasonAndPlan} (Kolaborasi WFA bersama ${prev.userName})`;
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
                  recordType: 'WFA',
                  workflowType: wf,
                  totalWorkHours: sys.locationConfig.standardDailyHours,
                  isOutsideWorkLocation: false,
                  outsideReviewStatus: 'NOT_REQUIRED',
                  isFlextimeApplied: false,
                  wfaRequestId: prev.id,
                  timesheetItems: [
                    {
                      id: `ts-wfa-${Date.now()}-${dStr}-${pUser.id}`,
                      category: 'Perencanaan & Pengembangan',
                      shortDescription: descForParticipant,
                      createdAt: nowIso,
                    },
                  ],
                  createdAt: nowIso,
                  updatedAt: nowIso,
                });
              } else if (!sys.records[recIdx].clockInTime) {
                sys.records[recIdx] = {
                  ...sys.records[recIdx],
                  recordType: 'WFA',
                  workflowType: wf,
                  totalWorkHours: sys.locationConfig.standardDailyHours,
                  wfaRequestId: prev.id,
                  timesheetItems:
                    sys.records[recIdx].timesheetItems.length > 0
                      ? sys.records[recIdx].timesheetItems
                      : [
                          {
                            id: `ts-wfa-${Date.now()}-${dStr}-${pUser.id}`,
                            category: 'Perencanaan & Pengembangan',
                            shortDescription: descForParticipant,
                            createdAt: nowIso,
                          },
                        ],
                  updatedAt: nowIso,
                };
              }
            }
          }
        }
      }

      appendAttendanceAudit(
        draft,
        currentUser,
        'WFA',
        `Pemrosesan WFA (${sys.wfaRequests[idx].status})`,
        `${currentUser.name} memproses WFA milik ${prev.userName} tanggal ${
          sDate === eDate ? sDate : `${sDate} s/d ${eDate}`
        }. Status: ${sys.wfaRequests[idx].status}. Catatan: ${notes || '-'}`,
        prev.userName
      );
    });

    if (errMsg) {
      return res.status(403).json({ error: errMsg });
    }
    res.json({ bundle: db.getData().attendanceSystem });
  });

  // 8. HARI LIBUR BERSAMA — WORKFLOW BERDASARKAN PERAN
  app.post('/api/attendance-system/holiday-requests', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    const {
      title,
      startDate,
      endDate,
      reason,
      autoApproveByHr,
    }: {
      userId?: string;
      title: string;
      startDate: string;
      endDate?: string;
      reason?: string;
      autoApproveByHr?: boolean;
    } = req.body || {};

    const resolvedStart = String(startDate || '').trim();
    const resolvedEnd = String(endDate || resolvedStart).trim();

    if (!title || !resolvedStart) {
      return res.status(400).json({ error: 'Judul Hari Libur Bersama dan tanggal mulai wajib diisi.' });
    }

    const nowIso = new Date().toISOString();
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

      const initialStatus =
        wf === 'DIRECTOR_TO_FINANCE_NOTIFY'
          ? 'Notified to Finance'
          : wf === 'FINANCE_TO_DIRECTOR_REVIEW'
          ? 'Submitted for Review'
          : isDirectHrApprove
          ? 'Approved'
          : 'Pending';

      const item: HolidayRequestRecord = {
        id: `hol-${Date.now()}`,
        userId: 'ALL_TEAM',
        userName: 'Seluruh Tim WIJNA',
        userRoleTitle: `Hari Libur Bersama (Oleh: ${currentUser.name})`,
        department: 'Seluruh Divisi WIJNA',
        workflowType: wf,
        title: String(title).trim(),
        startDate: resolvedStart,
        endDate: resolvedEnd,
        totalDays,
        reason: String(reason || '').trim(),
        status: initialStatus,
        reviewedByName: isDirectHrApprove ? currentUser.name : undefined,
        reviewedAt: isDirectHrApprove ? nowIso : undefined,
        reviewNotes: isDirectHrApprove
          ? 'Ditetapkan sebagai Hari Libur Bersama oleh Finance & diajukan untuk review Director.'
          : undefined,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      sys.holidayRequests.unshift(item);

      appendAttendanceAudit(
        draft,
        currentUser,
        'HOLIDAY',
        `Pencatatan Hari Libur Bersama (${initialStatus})`,
        `${currentUser.name} mencatat Hari Libur Bersama "${item.title}" (${resolvedStart} s/d ${resolvedEnd}, ${totalDays} hari kerja) untuk Seluruh Tim WIJNA.`,
        'Seluruh Tim WIJNA'
      );
    });

    res.json({ bundle: db.getData().attendanceSystem });
  });

  app.post('/api/attendance-system/holiday-requests/:id/decision', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (!isHrAuthorized(currentUser) && !isDirectorAuthorized(currentUser)) {
      return res.status(403).json({ error: 'Hanya Finance atau Director yang dapat memproses Hari Libur Bersama.' });
    }
    const { id } = req.params;
    const {
      decision,
      notes,
    }: {
      stage?: 'hr' | 'director';
      decision: 'approve' | 'return' | 'reject' | 'review' | 'acknowledge';
      notes?: string;
    } = req.body || {};

    if ((decision === 'return' || decision === 'reject') && (!notes || !String(notes).trim())) {
      return res.status(400).json({
        error: 'Pengembalian (Return) usulan Hari Libur Bersama wajib menyertakan alasan atau catatan dari Finance.',
      });
    }

    const nowIso = new Date().toISOString();
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      if (!Array.isArray(sys.holidayRequests)) {
        sys.holidayRequests = [];
      }
      const idx = sys.holidayRequests.findIndex((h) => h.id === id);
      if (idx === -1) return;

      const prev = sys.holidayRequests[idx];
      const wf = prev.workflowType || 'EMPLOYEE_TO_FINANCE_APPROVAL';
      const isReturning = decision === 'return' || decision === 'reject';
      const isApproved = !isReturning;

      if (wf === 'DIRECTOR_TO_FINANCE_NOTIFY' && isHrAuthorized(currentUser)) {
        sys.holidayRequests[idx] = {
          ...prev,
          status: 'Acknowledged by Finance',
          financeAcknowledgedByName: currentUser.name,
          financeAcknowledgedAt: nowIso,
          financeAckNotes: notes ? String(notes).trim() : 'Telah dicatat oleh Finance.',
          updatedAt: nowIso,
        };
      } else if (wf === 'FINANCE_TO_DIRECTOR_REVIEW' && isDirectorAuthorized(currentUser)) {
        sys.holidayRequests[idx] = {
          ...prev,
          status: 'Reviewed by Director',
          directorAcknowledgedByName: currentUser.name,
          directorAcknowledgedAt: nowIso,
          directorReviewNotes: notes ? String(notes).trim() : 'Direview oleh Director.',
          updatedAt: nowIso,
        };
      } else {
        sys.holidayRequests[idx] = {
          ...prev,
          status: isApproved ? 'Approved' : 'Returned',
          reviewedByName: currentUser.name,
          reviewedAt: nowIso,
          returnReason: !isApproved && notes ? String(notes).trim() : undefined,
          reviewNotes: notes
            ? String(notes).trim()
            : isApproved
            ? 'Approved oleh Finance.'
            : 'Returned oleh Finance.',
          updatedAt: nowIso,
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
              recordType: 'HOLIDAY',
              workflowType: wf,
              totalWorkHours: 0,
              isOutsideWorkLocation: false,
              outsideReviewStatus: 'NOT_REQUIRED',
              isFlextimeApplied: false,
              holidayRequestId: prev.id,
              holidayTitle: prev.title,
              timesheetItems: [],
              createdAt: nowIso,
              updatedAt: nowIso,
            });
          } else if (!sys.records[recIdx].clockInTime) {
            sys.records[recIdx] = {
              ...sys.records[recIdx],
              recordType: 'HOLIDAY',
              workflowType: wf,
              totalWorkHours: 0,
              holidayRequestId: prev.id,
              holidayTitle: prev.title,
              updatedAt: nowIso,
            };
          }
        }
      }

      appendAttendanceAudit(
        draft,
        currentUser,
        'HOLIDAY',
        `Pemrosesan Hari Libur Bersama (${sys.holidayRequests[idx].status})`,
        `${currentUser.name} memproses Hari Libur Bersama "${prev.title}" (${prev.startDate} s/d ${prev.endDate}). Catatan: ${notes || '-'}`,
        prev.userName
      );
    });

    res.json({ bundle: db.getData().attendanceSystem });
  });

  // 9. RIWAYAT MULTI PELATIHAN KARYAWAN — INPUT MANUAL OLEH HR & DISETUJUI OLEH DIRECTOR
  app.post('/api/attendance-system/employee-trainings', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (!isHrAuthorized(currentUser)) {
      return res.status(403).json({
        error: 'Hanya HR (Finance & HR) yang berwenang menginput atau memperbarui data pelatihan karyawan.',
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
      items,
    }: {
      id?: string;
      userId: string;
      trainingTitle?: string;
      organizer?: string;
      category?: string;
      startDate?: string;
      endDate?: string;
      durationHours?: number;
      certificateOrEvidenceUrl?: string;
      competencyNotes?: string;
      items?: Array<{
        trainingTitle: string;
        organizer: string;
        category: string;
        startDate: string;
        endDate?: string;
        durationHours?: number;
        certificateOrEvidenceUrl?: string;
        competencyNotes?: string;
      }>;
    } = req.body || {};

    if (!userId) {
      return res.status(400).json({ error: 'Pilih karyawan terlebih dahulu.' });
    }

    const batchList =
      Array.isArray(items) && items.length > 0
        ? items.filter((it) => String(it.trainingTitle || '').trim())
        : trainingTitle && String(trainingTitle).trim()
        ? [
            {
              trainingTitle: String(trainingTitle).trim(),
              organizer: String(organizer || 'Penyelenggara Pelatihan').trim(),
              category: String(category || 'Pengembangan Kapasitas').trim(),
              startDate: String(startDate || new Date().toISOString().slice(0, 10)).trim(),
              endDate: String(endDate || startDate || new Date().toISOString().slice(0, 10)).trim(),
              durationHours: Number(durationHours) || 8,
              certificateOrEvidenceUrl: certificateOrEvidenceUrl
                ? String(certificateOrEvidenceUrl).trim()
                : undefined,
              competencyNotes: competencyNotes ? String(competencyNotes).trim() : undefined,
            },
          ]
        : [];

    if (batchList.length === 0) {
      return res.status(400).json({ error: 'Nama pelatihan wajib diisi minimal 1 pelatihan.' });
    }

    const nowIso = new Date().toISOString();
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
            organizer: entry.organizer || 'Penyelenggara Pelatihan',
            category: entry.category || 'Pengembangan Kapasitas',
            startDate: entry.startDate,
            endDate: entry.endDate || entry.startDate,
            durationHours: Math.max(1, Number(entry.durationHours) || 8),
            certificateOrEvidenceUrl: entry.certificateOrEvidenceUrl,
            competencyNotes: entry.competencyNotes,
            status: 'Menunggu Persetujuan Director',
            createdByHrId: currentUser.id,
            createdByHrName: currentUser.name,
            updatedAt: nowIso,
          };

          appendAttendanceAudit(
            draft,
            currentUser,
            'TRAINING',
            'Pembaruan Data Pelatihan Karyawan oleh HR',
            `HR (${currentUser.name}) memperbarui data pelatihan "${entry.trainingTitle}" untuk ${targetUser.name} dan mengajukan persetujuan Director.`,
            targetUser.name
          );
          return;
        }
      }

      for (let i = 0; i < batchList.length; i++) {
        const entry = batchList[i];
        const newRec: EmployeeTrainingRecord = {
          id: `trn-${Date.now()}-${i}`,
          userId: targetUser.id,
          userName: targetUser.name,
          userRoleTitle: targetUser.roleTitle,
          department: targetUser.department,
          trainingTitle: entry.trainingTitle,
          organizer: entry.organizer || 'Penyelenggara Pelatihan',
          category: entry.category || 'Pengembangan Kapasitas',
          startDate: entry.startDate,
          endDate: entry.endDate || entry.startDate,
          durationHours: Math.max(1, Number(entry.durationHours) || 8),
          certificateOrEvidenceUrl: entry.certificateOrEvidenceUrl,
          competencyNotes: entry.competencyNotes,
          status: 'Menunggu Persetujuan Director',
          createdByHrId: currentUser.id,
          createdByHrName: currentUser.name,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        sys.employeeTrainings.unshift(newRec);
      }

      appendAttendanceAudit(
        draft,
        currentUser,
        'TRAINING',
        `Input Manual ${batchList.length} Pelatihan Karyawan oleh HR`,
        `HR (${currentUser.name}) menambahkan ${batchList.length} catatan pelatihan untuk ${targetUser.name} (${batchList
          .map((b) => `"${b.trainingTitle}"`)
          .join(', ')}) — Menunggu Persetujuan Director.`,
        targetUser.name
      );
    });

    res.json({ bundle: db.getData().attendanceSystem });
  });

  app.delete('/api/attendance-system/employee-trainings/:id', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (!isHrAuthorized(currentUser) && !isDirectorAuthorized(currentUser)) {
      return res.status(403).json({ error: 'Hanya HR atau Director yang dapat menghapus catatan pelatihan.' });
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
          'TRAINING',
          'Penghapusan Catatan Pelatihan Karyawan',
          `${currentUser.name} menghapus catatan pelatihan "${found.trainingTitle}" milik ${found.userName}.`,
          found.userName
        );
      }
    });

    res.json({ bundle: db.getData().attendanceSystem });
  });

  app.post('/api/attendance-system/employee-trainings/:id/decision', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (!isDirectorAuthorized(currentUser)) {
      return res.status(403).json({
        error: 'Hanya Director yang berwenang menyetujui atau meminta revisi data pelatihan karyawan.',
      });
    }
    const { id } = req.params;
    const {
      decision,
      notes,
      userId,
    }: {
      decision: 'approve' | 'revision' | 'reject';
      notes?: string;
      userId?: string;
    } = req.body || {};

    const nowIso = new Date().toISOString();
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      if (!Array.isArray(sys.employeeTrainings)) {
        sys.employeeTrainings = [];
      }

      const nextStatus: EmployeeTrainingApprovalStatus =
        decision === 'approve'
          ? 'Disetujui Director'
          : decision === 'revision'
          ? 'Perlu Revisi'
          : 'Ditolak Director';

      // Mendukung persetujuan sekaligus (batch) untuk satu karyawan jika id === 'ALL_PENDING'
      if (id === 'ALL_PENDING' && userId) {
        let count = 0;
        let targetName = '';
        sys.employeeTrainings = sys.employeeTrainings.map((t, i) => {
          if (t.userId === userId && t.status === 'Menunggu Persetujuan Director') {
            count++;
            targetName = t.userName;
            const stampSuffix = Math.random().toString(16).slice(2, 6).toUpperCase();
            return {
              ...t,
              status: nextStatus,
              directorDecisionByName: currentUser.name,
              directorDecisionAt: nowIso,
              directorNotes:
                notes && String(notes).trim()
                  ? String(notes).trim()
                  : decision === 'approve'
                  ? 'Disetujui oleh Executive Director dan disahkan dalam portofolio karyawan.'
                  : undefined,
              directorSignatureCode:
                decision === 'approve' ? `STAMP-DIR-TRN-${String(i + 1).padStart(3, '0')}-${stampSuffix}` : undefined,
              updatedAt: nowIso,
            };
          }
          return t;
        });

        if (count > 0) {
          appendAttendanceAudit(
            draft,
            currentUser,
            'TRAINING',
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
        directorNotes:
          notes && String(notes).trim()
            ? String(notes).trim()
            : decision === 'approve'
            ? 'Disetujui oleh Executive Director.'
            : decision === 'revision'
            ? 'Mohon HR melengkapi rincian penyelenggara / tautan sertifikat pelatihan.'
            : 'Ditolak oleh Executive Director.',
        directorSignatureCode:
          decision === 'approve' ? `STAMP-DIR-TRN-${stampSuffix}` : undefined,
        updatedAt: nowIso,
      };

      appendAttendanceAudit(
        draft,
        currentUser,
        'TRAINING',
        `Keputusan Director atas Pelatihan Karyawan (${nextStatus})`,
        `Director (${currentUser.name}) menetapkan status "${nextStatus}" untuk pelatihan "${prev.trainingTitle}" milik ${prev.userName}. Catatan: ${notes || '-'}`,
        prev.userName
      );
    });

    res.json({ bundle: db.getData().attendanceSystem });
  });

  app.post('/api/attendance-system/employee-profile-link', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (!isHrAuthorized(currentUser) && !isDirectorAuthorized(currentUser)) {
      return res.status(403).json({
        error: 'Hanya HR (Finance & HR) yang berwenang mengatur tautan dokumen profil karyawan.',
      });
    }
    const {
      userId,
      label,
      url,
    }: {
      userId: string;
      label?: string;
      url: string;
    } = req.body || {};

    if (!userId) {
      return res.status(400).json({ error: 'Karyawan wajib dipilih.' });
    }

    const nowIso = new Date().toISOString();
    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      if (!sys.employeeProfileLinks || typeof sys.employeeProfileLinks !== 'object') {
        sys.employeeProfileLinks = {};
      }
      const targetUser = (draft.users || []).find((u) => u.id === userId);
      const trimmedUrl = String(url || '').trim();
      const trimmedLabel =
        String(label || '').trim() ||
        `Dokumen & Portofolio Karyawan — ${targetUser?.name || userId}`;

      if (!trimmedUrl) {
        delete sys.employeeProfileLinks[userId];
      } else {
        sys.employeeProfileLinks[userId] = {
          userId,
          label: trimmedLabel,
          url: trimmedUrl,
          updatedByName: currentUser.name,
          updatedAt: nowIso,
        };
      }

      appendAttendanceAudit(
        draft,
        currentUser,
        'POLICY',
        'Pembaruan Link Dokumen Profil Karyawan oleh HR',
        `HR (${currentUser.name}) memperbarui tautan dokumen profil untuk ${targetUser?.name || userId}: ${trimmedUrl || 'Dihapus'}.`,
        targetUser?.name
      );
    });

    res.json({ bundle: db.getData().attendanceSystem });
  });

  // 10. VERIFIKASI AUDIT DIGITAL REKAP KERJA RESMI (DISIMPAN PERMANEN DI DATABASE)
  app.post('/api/attendance-system/work-recap-verify', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (!isHrAuthorized(currentUser) && !isDirectorAuthorized(currentUser)) {
      return res.status(403).json({
        error: 'Akses ditolak: Hanya HR/Finance atau Direktur yang berwenang mengesahkan verifikasi Rekap Kerja Resmi.',
      });
    }

    const {
      userId,
      periodId,
      stage,
      notes,
    }: {
      userId: string;
      periodId: string;
      stage: 'finance' | 'director';
      notes?: string;
    } = req.body || {};

    if (!userId || !periodId || !stage) {
      return res.status(400).json({
        error: 'Identitas karyawan, periode pelaporan, dan tahap verifikasi wajib diisi.',
      });
    }

    if (stage === 'finance' && !isHrAuthorized(currentUser)) {
      return res.status(403).json({
        error: 'Hanya HR/Finance yang dapat melakukan verifikasi tahap HR/Finance.',
      });
    }
    if (stage === 'director' && !isDirectorAuthorized(currentUser)) {
      return res.status(403).json({
        error: 'Hanya Direktur yang dapat melakukan pengesahan tahap Direktur.',
      });
    }

    const nowIso = new Date().toISOString();
    const key = `${userId}__${periodId}`;

    db.update((draft) => {
      const sys = ensureAttendanceSystemInitialized(draft);
      if (!sys.workRecapVerifications || typeof sys.workRecapVerifications !== 'object') {
        sys.workRecapVerifications = {};
      }
      const targetUser = (draft.users || []).find((u) => u.id === userId);
      const existing = sys.workRecapVerifications[key] || {
        key,
        userId,
        periodId,
        financeVerified: false,
        financeVerifierName: '',
        financeVerifierRole: 'Finance & HR Manager',
        financeVerifiedAt: '',
        financeRefCode: `FIN-HR/${periodId.toUpperCase().slice(0, 6)}/${userId.replace(/^user-/, '').toUpperCase()}`,
        financeNotes: '',
        directorVerified: false,
        directorVerifierName: '',
        directorVerifierRole: 'Executive Director',
        directorVerifiedAt: '',
        directorRefCode: `DIR-OVS/${periodId.toUpperCase().slice(0, 6)}/${userId.replace(/^user-/, '').toUpperCase()}`,
        directorNotes: '',
        updatedAt: nowIso,
      };

      if (stage === 'finance') {
        existing.financeVerified = true;
        existing.financeVerifierName = currentUser.name;
        existing.financeVerifierRole = currentUser.roleTitle || 'Finance & HR Manager';
        existing.financeVerifiedAt = nowIso;
        existing.financeNotes =
          notes?.trim() ||
          'Catatan Timesheet, jam hadir, Flextime, dan WFA telah diverifikasi sesuai rekam jejak sistem.';
      } else {
        existing.directorVerified = true;
        existing.directorVerifierName = currentUser.name;
        existing.directorVerifierRole = currentUser.roleTitle || 'Executive Director';
        existing.directorVerifiedAt = nowIso;
        existing.directorNotes =
          notes?.trim() ||
          'Rekapitulasi Timesheet & Kehadiran disahkan sebagai dokumen resmi periode pelaporan.';
      }
      existing.updatedAt = nowIso;
      sys.workRecapVerifications[key] = existing;

      appendAttendanceAudit(
        draft,
        currentUser,
        'TIMESHEET',
        stage === 'finance'
          ? 'Verifikasi Audit Digital Rekap Kerja oleh HR/Finance'
          : 'Pengesahan Audit Digital Rekap Kerja oleh Direktur',
        `${currentUser.name} (${currentUser.roleTitle}) mengesahkan verifikasi audit digital Rekap Kerja untuk ${
          targetUser?.name || userId
        } (Periode: ${periodId}).`,
        targetUser?.name
      );
    });

    res.json({ bundle: db.getData().attendanceSystem });
  });

  // Reset demo data utility (Protected: Admin or Director only)
  app.post('/api/reset-data', (req: Request, res: Response) => {
    const currentUser = getCurrentUser(req);
    if (
      currentUser.role !== 'admin' &&
      currentUser.role !== 'director' &&
      !currentUser.permissions?.canManageUsers
    ) {
      return res.status(403).json({
        error: 'Akses ditolak: Hanya System Administrator atau Direktur yang berwenang mereset database.',
      });
    }
    db.resetToSeed();
    ensureUserSecurityFieldsInitialized();
    res.json({ message: 'Database telah direset ke konfigurasi awal' });
  });

  // Safe Production Error Handler for API routes (No stack traces leaked to client)
  app.use('/api', (err: any, _req: Request, res: Response, _next: express.NextFunction) => {
    console.error('[API Security Error]:', err?.message || 'Unexpected error');
    if (res.headersSent) return;
    res.status(err?.status || 500).json({
      error: 'Terjadi kesalahan pemrosesan pada server. Silakan periksa kembali data yang dikirimkan.',
    });
  });

  // --- VITE MIDDLEWARE / STATIC FILES ---
  const distIndexHtml = path.join(__dirname, 'dist', 'index.html');
  const isRunningCompiledServerJs = import.meta.url.endsWith('/server.js');
  if (
    process.env.NODE_ENV === 'production' ||
    (isRunningCompiledServerJs && fs.existsSync(distIndexHtml))
  ) {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(distIndexHtml);
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: null,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const startListening = (retriesLeft = 5) => {
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`[NGO System] Server running on http://0.0.0.0:${PORT}`);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && retriesLeft > 0) {
        console.warn(`[NGO System] Port ${PORT} is busy, retrying in 500ms... (${retriesLeft} retries left)`);
        setTimeout(() => {
          server.close();
          startListening(retriesLeft - 1);
        }, 500);
      } else if (err.code === 'EADDRINUSE') {
        console.warn(`[NGO System] Port ${PORT} is already serving requests.`);
      } else {
        console.error('Server error:', err);
      }
    });
  };

  startListening();
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
