import React, { useState } from 'react';
import { AuditLog } from '../../types/index.js';
import { History, Shield, Filter, Search } from 'lucide-react';

interface AuditTrailViewProps {
  logs: AuditLog[];
}

function resolveEffectiveEntityType(log: AuditLog): string {
  const raw = String(log.entityType || 'TOR').toUpperCase();
  if (raw === 'TOR') {
    const act = String(log.action || '').toLowerCase();
    if (act.includes('ringkasan realisasi') || act.includes('ringkasan akhir')) {
      return 'CASH_ADVANCE_SUMMARY';
    }
    if (act.includes('cash advance') || act.includes('kasbon')) {
      return 'CASH_ADVANCE';
    }
  }
  return raw;
}

const ENTITY_LABELS: Record<string, string> = {
  TOR: 'TOR & Implementasi',
  PROGRAM: 'Program & Logframe',
  CASH_ADVANCE: 'Cash Advance',
  CASH_ADVANCE_SUMMARY: 'Ringkasan CA',
  PARTICIPANT: 'Peserta',
  ATTENDANCE: 'Kehadiran & SDM',
  USER: 'Pengguna',
  AUTH: 'Autentikasi',
};

export const AuditTrailView: React.FC<AuditTrailViewProps> = ({ logs }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');

  const filtered = (Array.isArray(logs) ? logs : []).filter((log) => {
    const effectiveType = resolveEffectiveEntityType(log);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const match =
        (log.actorName || '').toLowerCase().includes(q) ||
        (log.action || '').toLowerCase().includes(q) ||
        (log.details || '').toLowerCase().includes(q) ||
        effectiveType.toLowerCase().includes(q);
      if (!match) return false;
    }
    if (filterType !== 'all' && effectiveType !== filterType) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
            <History className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">Jejak Audit & Akuntabilitas (Audit Trail)</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Catatan kepatuhan seluruh aktivitas Program, TOR, Cash Advance, Peserta, Kehadiran, dan pengelolaan akun organisasi.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
        {/* Filter bar */}
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs font-semibold text-slate-700">
            Total {filtered.length} Catatan Aktivitas
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <input
              type="text"
              placeholder="Cari aktivitas, pelaku, nomor dokumen..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="text-xs bg-white border border-slate-300 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 w-full sm:w-64"
            />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="text-xs bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-700 focus:outline-none"
            >
              <option value="all">Semua Modul</option>
              <option value="PROGRAM">Program & Logframe</option>
              <option value="TOR">TOR & Implementasi</option>
              <option value="CASH_ADVANCE">Cash Advance</option>
              <option value="CASH_ADVANCE_SUMMARY">Ringkasan Cash Advance</option>
              <option value="PARTICIPANT">Database Peserta</option>
              <option value="ATTENDANCE">Kehadiran & SDM</option>
              <option value="USER">Pengguna</option>
              <option value="AUTH">Autentikasi</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs md:text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100/50 text-slate-600 font-semibold uppercase text-[11px] tracking-wider">
                <th className="py-3 px-4">Waktu</th>
                <th className="py-3 px-4">Aktor / Pengguna</th>
                <th className="py-3 px-4">Tindakan</th>
                <th className="py-3 px-4">Modul</th>
                <th className="py-3 px-4">Rincian Perubahan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    Tidak ada catatan audit yang sesuai.
                  </td>
                </tr>
              ) : (
                filtered.map((log) => {
                  const effectiveType = resolveEffectiveEntityType(log);
                  return (
                    <tr key={log.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 text-slate-500 whitespace-nowrap font-mono text-xs">
                        {new Date(log.timestamp).toLocaleString('id-ID', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{log.actorName}</div>
                        <div className="text-[11px] text-slate-400">{log.actorRole}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-semibold text-slate-800">{log.action}</span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-xs font-medium text-slate-600">
                        {ENTITY_LABELS[effectiveType] || effectiveType}
                      </td>
                      <td className="py-3 px-4 text-slate-700 text-xs">
                        {log.details}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
