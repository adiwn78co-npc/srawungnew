import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Printer,
  CheckCircle2,
  AlertTriangle,
  Clock,
  UserCheck,
  Send,
  Edit3,
  DollarSign,
  AlertCircle,
  FileCheck,
  Download,
  Wallet,
  XCircle,
  RotateCcw,
} from 'lucide-react';
import {
  CashAdvanceRecord,
  User,
  CashAdvanceStatus,
} from '../../types/index.js';
import { formatRupiah } from '../../lib/terbilang.js';
import { formatIndonesianDate } from '../../lib/dateUtils.js';
import { api } from '../../lib/api.js';
import { downloadElementAsPdf } from '../../lib/pdfDownload.js';
import { ApprovalBarcodeStamp } from '../common/ApprovalBarcodeStamp.js';

interface CashAdvanceDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  record: CashAdvanceRecord | null;
  currentUser: User | null;
  onRefresh: () => void;
  onEdit?: (record: CashAdvanceRecord) => void;
  inline?: boolean;
}

export const CashAdvanceDetailModal: React.FC<CashAdvanceDetailModalProps> = ({
  isOpen,
  onClose,
  record: propRecord,
  currentUser,
  onRefresh,
  onEdit,
  inline = false,
}) => {
  const [liveRecord, setLiveRecord] = useState<CashAdvanceRecord | null>(propRecord);
  const [systemUsers, setSystemUsers] = useState<User[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [transferReference, setTransferReference] = useState('');
  const [bankSource, setBankSource] = useState('Bank Mandiri Operasional Yayasan');
  const [confirmNotes, setConfirmNotes] = useState('');
  const confirmPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLiveRecord(propRecord);
    if (propRecord) {
      setTransferReference(
        propRecord.signatures?.disbursedBy?.transferReference ||
          `KONF-FM-${propRecord.id.slice(-6).toUpperCase()}`
      );
      setBankSource(
        propRecord.signatures?.disbursedBy?.bankSource ||
          'Bank Mandiri Operasional Yayasan'
      );
      setConfirmNotes(propRecord.signatures?.disbursedBy?.notes || '');
    }
  }, [propRecord]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    api
      .getUsers()
      .then((list) => {
        if (active && Array.isArray(list)) {
          setSystemUsers(list);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isOpen]);

  const record = liveRecord || propRecord;
  if (!isOpen || !record) return null;

  const financeManagerUser = systemUsers.find(
    (u) => u.isActive !== false && u.role === 'finance'
  );
  const directorUser = systemUsers.find(
    (u) => u.isActive !== false && u.role === 'director'
  );

  const resolvedVerifiedName =
    record.signatures.verifiedBy?.name || financeManagerUser?.name || '-';
  const resolvedVerifiedRole =
    record.signatures.verifiedBy?.roleTitle ||
    financeManagerUser?.roleTitle ||
    'Finance Manager';
  const resolvedApprovedName =
    record.signatures.approvedBy?.name || directorUser?.name || '-';
  const resolvedApprovedRole =
    record.signatures.approvedBy?.roleTitle ||
    directorUser?.roleTitle ||
    'Executive Director';
  const resolvedDisbursedName =
    record.signatures.disbursedBy?.name || financeManagerUser?.name || '-';
  const resolvedDisbursedRole =
    record.signatures.disbursedBy?.roleTitle ||
    financeManagerUser?.roleTitle ||
    'Finance Manager';

  const canActAsFinanceManager = Boolean(
    currentUser &&
      (currentUser.role === 'finance' ||
        currentUser.role === 'system_admin' ||
        currentUser.role === 'admin')
  );
  const canActAsDirector = Boolean(
    currentUser &&
      (currentUser.role === 'director' || currentUser.role === 'system_admin')
  );
  const canVerifySubmitted = Boolean(
    record.status === 'Diajukan' &&
      canActAsFinanceManager &&
      (record.requesterId !== currentUser?.id ||
        currentUser?.role === 'system_admin')
  );
  const canDirectorApprove = Boolean(
    record.status === 'Diverifikasi Finance' && canActAsDirector
  );
  const canConfirmDisbursement = Boolean(
    record.status === 'Disetujui' && canActAsFinanceManager
  );

  const handleSubmitDraft = async () => {
    setActionLoading(true);
    setErrorMsg(null);
    try {
      const updated = await api.submitCashAdvance(record.id);
      setLiveRecord(updated);
      setSuccessMsg('Pengajuan Cash Advance berhasil dikirim ke Finance Manager dan tersimpan di MySQL.');
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal mengajukan kasbon');
    } finally {
      setActionLoading(false);
    }
  };

  const handleVerifyAction = async (action: 'verify' | 'revision' | 'reject') => {
    setActionLoading(true);
    setErrorMsg(null);
    try {
      const updated = await api.verifyCashAdvance(
        record.id,
        action,
        reviewNotes.trim() || undefined
      );
      setLiveRecord(updated);
      setReviewNotes('');
      setSuccessMsg(
        action === 'verify'
          ? 'Cash Advance berhasil diverifikasi oleh Finance Manager dan diteruskan ke Direktur.'
          : action === 'revision'
          ? 'Cash Advance dikembalikan ke pengaju untuk perbaikan.'
          : 'Cash Advance telah ditolak oleh Finance Manager.'
      );
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memproses verifikasi Finance Manager');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDirectorAction = async (action: 'approve' | 'reject') => {
    setActionLoading(true);
    setErrorMsg(null);
    try {
      const updated = await api.approveCashAdvance(
        record.id,
        action,
        reviewNotes.trim() || undefined
      );
      setLiveRecord(updated);
      setReviewNotes('');
      setSuccessMsg(
        action === 'approve'
          ? 'Cash Advance telah di-ACC oleh Direktur. Selanjutnya menunggu Konfirmasi & Pencairan oleh Finance Manager.'
          : 'Cash Advance telah ditolak oleh Direktur.'
      );
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memproses keputusan Direktur');
    } finally {
      setActionLoading(false);
    }
  };

  const handleFinanceManagerConfirm = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setActionLoading(true);
    setErrorMsg(null);
    try {
      const updated = await api.disburseCashAdvance(
        record.id,
        transferReference.trim() || undefined,
        bankSource.trim() || undefined,
        confirmNotes.trim() || undefined
      );
      setLiveRecord(updated);
      setSuccessMsg(
        `Konfirmasi & Pencairan Dana berhasil disimpan ke MySQL oleh ${updated.signatures.disbursedBy?.name || currentUser?.name || 'Finance Manager'} (Ref: ${updated.signatures.disbursedBy?.transferReference || '-'}).`
      );
      onRefresh();
    } catch (err: any) {
      setErrorMsg(
        err.message || 'Gagal menyimpan konfirmasi & pencairan Finance Manager'
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handlePrint = () => {
    downloadElementAsPdf({
      filename: `${record.advanceNumber}_${record.activityTitle}`,
    });
  };

  const handleExportDocx = () => {
    const itemsRowsHtml = (record.items || [])
      .map(
        (item, idx) => `
        <tr>
          <td style="border:1px solid #000; padding:6px; text-align:center;">${idx + 1}</td>
          <td style="border:1px solid #000; padding:6px; text-align:center;">${item.budgetCode || '-'}</td>
          <td style="border:1px solid #000; padding:6px;">${item.description || '-'}</td>
          <td style="border:1px solid #000; padding:6px; text-align:center;">${item.volume}</td>
          <td style="border:1px solid #000; padding:6px; text-align:center;">${item.unit || 'Paket'}</td>
          <td style="border:1px solid #000; padding:6px; text-align:center;">${item.frequency || 1}</td>
          <td style="border:1px solid #000; padding:6px; text-align:center;">${item.frequencyUnit || 'Kegiatan'}</td>
          <td style="border:1px solid #000; padding:6px; text-align:right;">${formatRupiah(item.unitPrice)}</td>
          <td style="border:1px solid #000; padding:6px; text-align:right; font-weight:bold;">${formatRupiah(item.totalAmount)}</td>
        </tr>`
      )
      .join('');

    const htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset="utf-8">
        <title>${record.advanceNumber}</title>
        <style>
          body { font-family: "Times New Roman", Times, serif; font-size: 12pt; color: #000000; line-height: 1.38; }
          .section-bar { background-color: #CCCCCC; font-weight: bold; padding: 4px 8px; margin-top: 14px; margin-bottom: 8px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
          td, th { border: 1px solid #000000; padding: 6px 8px; vertical-align: top; font-size: 11pt; }
        </style>
      </head>
      <body>
        <div style="text-align:center; font-weight:bold; font-size:14pt; text-transform:uppercase; margin-bottom:14px;">
          FORM PENGAJUAN CASH ADVANCE (UANG MUKA OPERASIONAL)<br/>
          ${record.activityTitle}
        </div>
        <div class="section-bar">1. Informasi Pengajuan &amp; Kegiatan (Cash Advance Information)</div>
        <table>
          <tr><td style="width:32%; font-weight:bold;">Nomor Cash Advance</td><td>${record.advanceNumber}</td></tr>
          <tr><td style="font-weight:bold;">Tanggal Pengajuan</td><td>${formatIndonesianDate(record.requestDate)}</td></tr>
          <tr><td style="font-weight:bold;">Referensi TOR (Master Source)</td><td>${record.torNumber} — ${record.activityTitle}</td></tr>
          <tr><td style="font-weight:bold;">Tahapan Implementasi TOR</td><td>${record.implementationTimelineSummary || 'Seluruh Tahapan Implementasi TOR'}</td></tr>
          <tr><td style="font-weight:bold;">Periode Pelaksanaan</td><td>${formatIndonesianDate(record.activityStartDate)} – ${formatIndonesianDate(record.activityEndDate)}</td></tr>
          <tr><td style="font-weight:bold;">Batas Maksimal Pelaporan (H+7)</td><td>${formatIndonesianDate(record.reportingDeadlineDate || record.requestDate)}</td></tr>
          <tr><td style="font-weight:bold;">Lokasi Pelaksanaan</td><td>${record.location}</td></tr>
          <tr><td style="font-weight:bold;">Nama Pemohon (PIC)</td><td>${record.requesterName} (${record.requesterRole} · ${record.department})</td></tr>
          <tr><td style="font-weight:bold;">Rekening Tujuan Transfer</td><td>${record.bankName} · No. Rek: ${record.bankAccountNumber} a.n. ${record.bankAccountHolder}</td></tr>
          <tr><td style="font-weight:bold;">Status Dokumen</td><td>${record.status}</td></tr>
        </table>
        <div class="section-bar">2. Rincian Anggaran Kasbon (Budget Breakdown)</div>
        <table>
          <thead>
            <tr style="background:#F2F2F2; font-weight:bold;">
              <th>No</th><th>Kode</th><th>Deskripsi Kebutuhan</th><th>Vol</th><th>Satuan</th><th>Frek</th><th>Satuan</th><th>Biaya Satuan</th><th>Total</th>
            </tr>
          </thead>
          <tbody>${itemsRowsHtml}</tbody>
          <tfoot>
            <tr>
              <td colspan="8" style="text-align:right; font-weight:bold;">Total Diajukan:</td>
              <td style="text-align:right; font-weight:bold;">${formatRupiah(record.totalAmount)}</td>
            </tr>
            <tr>
              <td colspan="9"><strong>Terbilang:</strong> <em>"${record.amountInWords}"</em></td>
            </tr>
          </tfoot>
        </table>
        <div class="section-bar">4. Otorisasi &amp; Persetujuan Dokumen (Signatures &amp; Verification)</div>
        <table>
          <thead>
            <tr style="background:#F2F2F2; font-weight:bold; text-align:center;">
              <th style="width:25%;">1. Diajukan Oleh (Pemohon / PIC)</th>
              <th style="width:25%;">2. Diperiksa Oleh (Finance Manager)</th>
              <th style="width:25%;">3. Disetujui Oleh (Executive Director)</th>
              <th style="width:25%;">4. Dikonfirmasi &amp; Dicairkan Oleh (Finance Manager)</th>
            </tr>
          </thead>
          <tbody>
            <tr style="text-align:center;">
              <td>
                <strong><u>${record.signatures.requestedBy.name}</u></strong><br/>
                ${record.signatures.requestedBy.roleTitle}<br/>
                Tanggal: ${formatIndonesianDate(record.signatures.requestedBy.date)}
              </td>
              <td>
                <strong><u>${resolvedVerifiedName}</u></strong><br/>
                ${resolvedVerifiedRole}<br/>
                Tanggal: ${record.signatures.verifiedBy?.date ? formatIndonesianDate(record.signatures.verifiedBy.date) : '-'}
              </td>
              <td>
                <strong><u>${resolvedApprovedName}</u></strong><br/>
                ${resolvedApprovedRole}<br/>
                Tanggal: ${record.signatures.approvedBy?.date ? formatIndonesianDate(record.signatures.approvedBy.date) : '-'}
              </td>
              <td>
                <strong><u>${resolvedDisbursedName}</u></strong><br/>
                ${resolvedDisbursedRole}<br/>
                Tanggal: ${record.signatures.disbursedBy?.date ? formatIndonesianDate(record.signatures.disbursedBy.date) : '-'}
                ${record.signatures.disbursedBy?.transferReference ? `<br/>Ref: ${record.signatures.disbursedBy.transferReference}` : ''}
              </td>
            </tr>
          </tbody>
        </table>
      </body>
      </html>
    `;

    const blob = new Blob(['\ufeff', htmlContent], {
      type: 'application/msword;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${record.advanceNumber.replace(/[^a-zA-Z0-9-_]/g, '_')}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getStatusBadge = (status: CashAdvanceStatus) => {
    switch (status) {
      case 'Dicairkan':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-emerald-50 text-emerald-800 font-medium text-xs border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Dikonfirmasi &amp; Dicairkan (Finance Manager)</span>
          </span>
        );
      case 'Disetujui':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-blue-50 text-blue-800 font-medium text-xs border border-blue-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
            <span>Disetujui Direktur (Menunggu Konfirmasi Finance Manager)</span>
          </span>
        );
      case 'Diverifikasi Finance':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-indigo-50 text-indigo-800 font-medium text-xs border border-indigo-200">
            <FileCheck className="w-3.5 h-3.5 text-indigo-600" />
            <span>Diverifikasi Finance</span>
          </span>
        );
      case 'Diajukan':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-amber-50 text-amber-800 font-medium text-xs border border-amber-200">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            <span>Menunggu Verifikasi Finance</span>
          </span>
        );
      case 'Perlu Perbaikan':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-orange-50 text-orange-800 font-medium text-xs border border-orange-200">
            <AlertTriangle className="w-3.5 h-3.5 text-orange-600" />
            <span>Perlu Perbaikan</span>
          </span>
        );
      case 'Ditolak':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-rose-50 text-rose-800 font-medium text-xs border border-rose-200">
            <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
            <span>Ditolak</span>
          </span>
        );
      case 'Draft':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-stone-100 text-stone-700 font-medium text-xs border border-stone-200">
            <Clock className="w-3.5 h-3.5 text-stone-500" />
            <span>Draft</span>
          </span>
        );
    }
  };

  const documentContent = (
    <div className="space-y-4">
      {/* Top Action Bar (Sama seperti ToR dan Notulen) */}
      <div className="bg-white rounded-md border border-stone-200/80 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium text-stone-600 hover:text-stone-900 cursor-pointer"
          >
            ← Kembali ke Daftar Cash Advance
          </button>
          <span className="text-stone-300">|</span>
          <span className="font-mono text-xs text-stone-700 font-medium">
            {record.advanceNumber}
          </span>
          {getStatusBadge(record.status)}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {onEdit && (record.status === 'Draft' || record.status === 'Perlu Perbaikan') && (
            <button
              type="button"
              onClick={() => onEdit(record)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 text-xs font-medium cursor-pointer"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Edit Cash Advance</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleExportDocx}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 text-xs font-medium cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export DOCX</span>
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Simpan / Download PDF</span>
          </button>
          {!inline && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded transition-colors cursor-pointer"
              aria-label="Tutup"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Error message */}
      {errorMsg && (
        <div className="px-4 py-2.5 bg-rose-50 border border-rose-200 rounded text-rose-700 text-xs flex items-center gap-2 print:hidden">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Success / Notification feedback message */}
      {successMsg && (
        <div className="px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded text-emerald-800 text-xs flex items-center justify-between gap-2 print:hidden">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            className="text-[11px] font-semibold underline cursor-pointer shrink-0"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Panel Verifikasi Finance Manager (Tahap 2: Saat Status Diajukan) */}
      {canVerifySubmitted && (
        <div className="px-4 py-3.5 bg-indigo-50/90 border border-indigo-200 rounded-md text-xs space-y-2.5 print:hidden">
          <div className="flex items-center justify-between gap-2">
            <div className="font-bold text-indigo-950 flex items-center gap-1.5">
              <FileCheck className="w-4 h-4 text-indigo-700" />
              <span>Verifikasi Pengajuan oleh Finance Manager</span>
            </div>
            <span className="text-[11px] text-indigo-800 font-mono">
              Nominal: {formatRupiah(record.totalAmount)}
            </span>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              type="text"
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              placeholder="Catatan pemeriksaan Finance Manager (opsional)..."
              className="flex-1 px-3 py-1.5 rounded border border-indigo-200 bg-white text-stone-900 focus:outline-none focus:border-indigo-500"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => handleVerifyAction('verify')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-indigo-700 hover:bg-indigo-800 text-white font-semibold cursor-pointer disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Verifikasi (Finance Manager)</span>
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => handleVerifyAction('revision')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 font-medium cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Minta Revisi</span>
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => handleVerifyAction('reject')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-800 font-medium cursor-pointer disabled:opacity-50"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>Tolak</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Panel Persetujuan Akhir Direktur (Tahap 3: Saat Status Diverifikasi Finance) */}
      {canDirectorApprove && (
        <div className="px-4 py-3.5 bg-amber-50/90 border border-amber-200 rounded-md text-xs space-y-2.5 print:hidden">
          <div className="flex items-center justify-between gap-2">
            <div className="font-bold text-amber-950 flex items-center gap-1.5">
              <UserCheck className="w-4 h-4 text-amber-700" />
              <span>Persetujuan Akhir (ACC) oleh Executive Director</span>
            </div>
            <span className="text-[11px] text-amber-800">
              Terverifikasi oleh: <strong>{resolvedVerifiedName}</strong>
            </span>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              type="text"
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              placeholder="Catatan otorisasi Direktur (opsional)..."
              className="flex-1 px-3 py-1.5 rounded border border-amber-200 bg-white text-stone-900 focus:outline-none focus:border-amber-500"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => handleDirectorAction('approve')}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-semibold cursor-pointer disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>ACC / Setujui (Direktur)</span>
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => handleDirectorAction('reject')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-800 font-medium cursor-pointer disabled:opacity-50"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>Tolak</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tahap 4: Setelah Di-ACC Direktur -> Fitur Konfirmasi & Pencairan oleh Finance Manager */}
      {record.status === 'Disetujui' && (
        <div
          ref={confirmPanelRef}
          className="px-4 py-3.5 bg-blue-50/90 border border-blue-200 rounded-md text-xs space-y-3 print:hidden"
        >
          <div className="flex flex-wrap items-start justify-between gap-2.5 text-blue-950">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">
                  Telah Di-ACC oleh Direktur ({resolvedApprovedName}) — Menunggu Konfirmasi &amp; Pencairan oleh Finance Manager
                </div>
                <div className="text-[11px] text-blue-800 mt-0.5">
                  Nominal disetujui: <strong>{formatRupiah(record.totalAmount)}</strong> · Rekening Pengaju:{' '}
                  <strong>{record.requesterName}</strong> ({record.bankName} · {record.bankAccountNumber} a.n.{' '}
                  {record.bankAccountHolder}).
                </div>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-900 font-semibold text-[11px] border border-blue-200">
              Tahap 4: Konfirmasi Finance Manager
            </span>
          </div>

          {canConfirmDisbursement && (
            <form
              onSubmit={handleFinanceManagerConfirm}
              className="bg-white border border-blue-200 rounded p-3.5 space-y-3 text-stone-800"
            >
              <div className="font-bold text-stone-900 flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5 text-emerald-700" />
                <span>
                  Form Konfirmasi &amp; Pencairan Dana oleh Finance Manager ({currentUser?.name})
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                    No. Referensi Transfer / Konfirmasi
                  </label>
                  <input
                    type="text"
                    required
                    value={transferReference}
                    onChange={(e) => setTransferReference(e.target.value)}
                    placeholder="Contoh: KONF-FM-001234"
                    className="w-full px-2.5 py-1.5 rounded border border-stone-300 font-mono text-xs focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                    Rekening Sumber Pencairan
                  </label>
                  <input
                    type="text"
                    required
                    value={bankSource}
                    onChange={(e) => setBankSource(e.target.value)}
                    placeholder="Bank Mandiri Operasional Yayasan"
                    className="w-full px-2.5 py-1.5 rounded border border-stone-300 text-xs focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                    Catatan Konfirmasi Finance Manager
                  </label>
                  <input
                    type="text"
                    value={confirmNotes}
                    onChange={(e) => setConfirmNotes(e.target.value)}
                    placeholder="Konfirmasi pencairan pasca ACC Direktur..."
                    className="w-full px-2.5 py-1.5 rounded border border-stone-300 text-xs focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[11px] text-stone-500">
                  Konfirmasi ini langsung tersimpan permanen ke database MySQL dan mengesahkan tanda tangan Kolom 4 (Finance Manager).
                </span>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>
                    {actionLoading
                      ? 'Menyimpan ke MySQL...'
                      : 'Konfirmasi & Cairkan Dana (Finance Manager)'}
                  </span>
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Banner Status: Dana Telah Dikonfirmasi & Dicairkan oleh Finance Manager */}
      {record.status === 'Dicairkan' && (
        <div className="px-4 py-3 bg-emerald-50/90 border border-emerald-200 rounded-md text-xs flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex items-start gap-2.5 text-emerald-950">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">
                Telah Dikonfirmasi &amp; Dicairkan oleh Finance Manager ({resolvedDisbursedName}) · Notifikasi Dikirim ke Pengaju ({record.requesterName})
              </div>
              <div className="text-[11px] text-emerald-800 mt-0.5">
                Transfer ke <strong>{record.bankName}</strong> ({record.bankAccountNumber} a.n. {record.bankAccountHolder}) · Sumber:{' '}
                <strong>{record.signatures.disbursedBy?.bankSource || '-'}</strong> · Tanggal:{' '}
                <strong>
                  {record.signatures.disbursedBy?.date
                    ? formatIndonesianDate(record.signatures.disbursedBy.date)
                    : '-'}
                </strong>
                {record.signatures.disbursedBy?.transferReference
                  ? ` · Ref Konfirmasi: ${record.signatures.disbursedBy.transferReference}`
                  : ''}
                {record.signatures.disbursedBy?.notes
                  ? ` · Catatan: "${record.signatures.disbursedBy.notes}"`
                  : ''}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FORMAL DOCUMENT SHEET (DESAIN SAMA PERSIS DENGAN TOR & NOTULEN) */}
      <article
        className="tor-formal-print-sheet bg-white rounded border border-slate-300 px-8 py-8 sm:px-14 sm:py-12 shadow-xs space-y-5 text-[14px] leading-[1.38] text-black"
        style={{ fontFamily: '"Times New Roman", Times, Georgia, serif' }}
      >
        {/* Top Centered Title */}
        <div className="text-center pb-2">
          <div className="text-[16px] font-bold uppercase tracking-wide text-black">
            FORM PENGAJUAN CASH ADVANCE (UANG MUKA OPERASIONAL)
          </div>
          <div className="text-[15px] font-bold uppercase text-black mt-0.5">
            {record.activityTitle}
          </div>
        </div>

        {/* 1. Informasi Pengajuan & Kegiatan */}
        <section>
          <div
            className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2.5 text-[14px]"
            style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
          >
            1. Informasi Pengajuan &amp; Kegiatan (Cash Advance Information)
          </div>
          <table className="w-full text-left border-collapse border border-black text-[14px]">
            <tbody>
              <tr className="align-top">
                <td className="w-64 font-bold py-1.5 px-2.5 border border-black">
                  Nomor Cash Advance
                </td>
                <td className="py-1.5 px-2.5 border border-black font-bold">
                  {record.advanceNumber}
                </td>
              </tr>
              <tr className="align-top">
                <td className="font-bold py-1.5 px-2.5 border border-black">
                  Tanggal Pengajuan
                </td>
                <td className="py-1.5 px-2.5 border border-black">
                  {formatIndonesianDate(record.requestDate)}
                </td>
              </tr>
              <tr className="align-top">
                <td className="font-bold py-1.5 px-2.5 border border-black">
                  Referensi TOR (Master Source)
                </td>
                <td className="py-1.5 px-2.5 border border-black">
                  <strong>{record.torNumber}</strong> — {record.activityTitle}
                </td>
              </tr>
              <tr className="align-top">
                <td className="font-bold py-1.5 px-2.5 border border-black">
                  Tahapan Implementasi TOR
                </td>
                <td className="py-1.5 px-2.5 border border-black">
                  {record.implementationTimelineSummary ||
                    (record.implementationMode === 'single'
                      ? 'Satu Tahap Implementasi TOR'
                      : 'Seluruh Tahapan Implementasi TOR')}
                </td>
              </tr>
              <tr className="align-top">
                <td className="font-bold py-1.5 px-2.5 border border-black">
                  Periode Pelaksanaan
                </td>
                <td className="py-1.5 px-2.5 border border-black">
                  {formatIndonesianDate(record.activityStartDate)} –{' '}
                  {formatIndonesianDate(record.activityEndDate)}
                </td>
              </tr>
              <tr className="align-top">
                <td className="font-bold py-1.5 px-2.5 border border-black">
                  Batas Maksimal Pelaporan (H+7)
                </td>
                <td className="py-1.5 px-2.5 border border-black">
                  {formatIndonesianDate(record.reportingDeadlineDate || record.requestDate)} (
                  {record.isReported ? 'Laporan Telah Ditutup' : 'Belum Dilaporkan'})
                </td>
              </tr>
              <tr className="align-top">
                <td className="font-bold py-1.5 px-2.5 border border-black">
                  Lokasi Pelaksanaan
                </td>
                <td className="py-1.5 px-2.5 border border-black">{record.location}</td>
              </tr>
              <tr className="align-top">
                <td className="font-bold py-1.5 px-2.5 border border-black">
                  Nama Pemohon (PIC)
                </td>
                <td className="py-1.5 px-2.5 border border-black">
                  <strong>{record.requesterName}</strong> ({record.requesterRole} ·{' '}
                  {record.department})
                </td>
              </tr>
              <tr className="align-top">
                <td className="font-bold py-1.5 px-2.5 border border-black">
                  Rekening Transfer Tujuan Kasbon
                </td>
                <td className="py-1.5 px-2.5 border border-black">
                  <strong>{record.bankName}</strong> · No. Rekening:{' '}
                  <strong>{record.bankAccountNumber}</strong> a.n.{' '}
                  <strong>{record.bankAccountHolder}</strong>
                </td>
              </tr>
              <tr className="align-top">
                <td className="font-bold py-1.5 px-2.5 border border-black">
                  Status Otorisasi Dokumen
                </td>
                <td className="py-1.5 px-2.5 border border-black font-bold">
                  {record.status}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* 2. Rincian Anggaran Kasbon (Budget Breakdown) */}
        <section>
          <div
            className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2.5 text-[14px]"
            style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
          >
            2. Rincian Anggaran Kasbon (Budget Breakdown)
          </div>
          <table className="w-full table-fixed text-left border-collapse border border-black text-[13.5px]">
            <thead>
              <tr>
                <th className="w-[4.5%] border border-black px-1.5 py-1.5 text-center font-bold align-middle">
                  No
                </th>
                <th className="w-[7.5%] border border-black px-1.5 py-1.5 text-center font-bold align-middle">
                  Kode
                </th>
                <th className="w-[37%] border border-black px-2.5 py-1.5 font-bold align-middle">
                  Deskripsi Kebutuhan (Berdasarkan Tahapan Implementasi TOR)
                </th>
                <th className="w-[5.5%] border border-black px-1 py-1.5 text-center font-bold align-middle">
                  Vol
                </th>
                <th className="w-[7.5%] border border-black px-1.5 py-1.5 text-center font-bold align-middle">
                  Satuan
                </th>
                <th className="w-[5.5%] border border-black px-1 py-1.5 text-center font-bold align-middle">
                  Frek
                </th>
                <th className="w-[7.5%] border border-black px-1.5 py-1.5 text-center font-bold align-middle">
                  Satuan
                </th>
                <th className="w-[12.5%] border border-black px-2 py-1.5 text-right font-bold align-middle">
                  Biaya Satuan (Rp)
                </th>
                <th className="w-[12.5%] border border-black px-2 py-1.5 text-right font-bold align-middle">
                  Total (Rp)
                </th>
              </tr>
            </thead>
            <tbody>
              {(record.items || []).map((item, idx) => (
                <tr key={item.id || idx} className="align-top">
                  <td className="border border-black px-1.5 py-1.5 text-center">
                    {idx + 1}
                  </td>
                  <td className="border border-black px-1.5 py-1.5 text-center break-words">
                    {item.budgetCode || '-'}
                  </td>
                  <td className="border border-black px-2.5 py-1.5 leading-[1.38] break-words">
                    <div>{item.description}</div>
                    {item.notes && (
                      <div className="text-[12.5px] italic mt-0.5">
                        Catatan: {item.notes}
                      </div>
                    )}
                  </td>
                  <td className="border border-black px-1 py-1.5 text-center">
                    {item.volume}
                  </td>
                  <td className="border border-black px-1.5 py-1.5 text-center break-words">
                    {item.unit || 'Paket'}
                  </td>
                  <td className="border border-black px-1 py-1.5 text-center">
                    {item.frequency || 1}
                  </td>
                  <td className="border border-black px-1.5 py-1.5 text-center break-words">
                    {item.frequencyUnit || 'Kegiatan'}
                  </td>
                  <td className="border border-black px-2 py-1.5 text-right whitespace-nowrap">
                    {formatRupiah(item.unitPrice)}
                  </td>
                  <td className="border border-black px-2 py-1.5 text-right font-bold whitespace-nowrap">
                    {formatRupiah(item.totalAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td
                  colSpan={8}
                  className="border border-black px-2.5 py-1.5 text-right font-bold"
                >
                  Total Cash Advance Diajukan
                </td>
                <td className="border border-black px-2 py-1.5 text-right font-bold whitespace-nowrap">
                  {formatRupiah(record.totalAmount)}
                </td>
              </tr>
              <tr>
                <td colSpan={9} className="border border-black px-2.5 py-1.5">
                  <strong>Terbilang (Amount in Words):</strong>{' '}
                  <span className="italic">"{record.amountInWords}"</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </section>

        {/* 3. Ketentuan & Regulasi Pertanggungjawaban Keuangan */}
        <section>
          <div
            className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2.5 text-[14px]"
            style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
          >
            3. Ketentuan &amp; Regulasi Pertanggungjawaban Keuangan
          </div>
          <ol className="list-decimal pl-6 space-y-1">
            {(record.complianceNotes && record.complianceNotes.length > 0
              ? record.complianceNotes
              : [
                  'Dana Cash Advance wajib dipertanggungjawabkan paling lambat 7 (tujuh) hari kalender setelah pengajuan dana.',
                  'Penutupan laporan Cash Advance wajib menyertakan lampiran Link PDF Expensify dan bukti transaksi asli pada Tahap 03 (Ringkasan Cash Advance).',
                  'Pengajuan Cash Advance baru tidak dapat diproses apabila masih terdapat 2 (dua) Cash Advance aktif yang belum ditutup laporannya.',
                ]
            ).map((note, idx) => (
              <li key={idx} className="leading-[1.38]">
                {note}
              </li>
            ))}
          </ol>
        </section>

        {/* 4. Otorisasi & Persetujuan Dokumen (Signatures & Verification) */}
        <section>
          <div
            className="bg-[#CCCCCC] text-black font-bold px-2.5 py-1 mb-2.5 text-[14px]"
            style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
          >
            4. Otorisasi &amp; Persetujuan Dokumen (Signatures &amp; Verification)
          </div>
          <table className="w-full text-left border-collapse border border-black text-[14px]">
            <thead>
              <tr>
                <th className="w-1/4 border border-black px-2.5 py-1.5 font-bold text-center">
                  1. Diajukan Oleh (Pemohon / PIC)
                </th>
                <th className="w-1/4 border border-black px-2.5 py-1.5 font-bold text-center">
                  2. Diperiksa Oleh (Finance Manager)
                </th>
                <th className="w-1/4 border border-black px-2.5 py-1.5 font-bold text-center">
                  3. Disetujui Oleh (Executive Director)
                </th>
                <th className="w-1/4 border border-black px-2.5 py-1.5 font-bold text-center">
                  4. Dikonfirmasi &amp; Dicairkan Oleh (Finance Manager)
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="align-top">
                <td className="border border-black px-2.5 py-2 text-center">
                  <div className="min-h-[64px] flex items-center justify-center italic text-[12px] py-1">
                    {record.status !== 'Draft' ? (
                      <ApprovalBarcodeStamp
                        documentNumber={record.advanceNumber}
                        roleCode="PIC"
                        signerName={record.signatures.requestedBy.name}
                        signDate={record.signatures.requestedBy.date}
                        statusLabel="TELAH DIAJUKAN"
                      />
                    ) : (
                      '[Draft]'
                    )}
                  </div>
                  <div className="font-bold underline">
                    {record.signatures.requestedBy.name}
                  </div>
                  <div className="text-[12.5px]">
                    {record.signatures.requestedBy.roleTitle}
                  </div>
                  <div className="text-[12px] mt-1">
                    Tanggal: {formatIndonesianDate(record.signatures.requestedBy.date)}
                  </div>
                </td>

                <td className="border border-black px-2.5 py-2 text-center">
                  <div className="min-h-[64px] flex items-center justify-center italic text-[12px] py-1">
                    {record.signatures.verifiedBy?.status === 'Terverifikasi' ||
                    record.status === 'Diverifikasi Finance' ||
                    record.status === 'Disetujui' ||
                    record.status === 'Dicairkan' ? (
                      <ApprovalBarcodeStamp
                        documentNumber={record.advanceNumber}
                        roleCode="FIN"
                        signerName={resolvedVerifiedName}
                        signDate={record.signatures.verifiedBy?.date || record.requestDate}
                        statusLabel="TERVERIFIKASI"
                      />
                    ) : (
                      `[${
                        record.signatures.verifiedBy?.status ||
                        'Menunggu Verifikasi Finance Manager'
                      }]`
                    )}
                  </div>
                  <div className="font-bold underline">{resolvedVerifiedName}</div>
                  <div className="text-[12.5px]">{resolvedVerifiedRole}</div>
                  <div className="text-[12px] mt-1">
                    Tanggal:{' '}
                    {record.signatures.verifiedBy?.date
                      ? formatIndonesianDate(record.signatures.verifiedBy.date)
                      : '-'}
                  </div>
                  {record.signatures.verifiedBy?.notes && (
                    <div className="text-[12px] italic mt-1">
                      "{record.signatures.verifiedBy.notes}"
                    </div>
                  )}
                </td>

                <td className="border border-black px-2.5 py-2 text-center">
                  <div className="min-h-[64px] flex items-center justify-center italic text-[12px] py-1">
                    {record.signatures.approvedBy?.status === 'Disetujui' ||
                    record.status === 'Disetujui' ||
                    record.status === 'Dicairkan' ? (
                      <ApprovalBarcodeStamp
                        documentNumber={record.advanceNumber}
                        roleCode="DIR"
                        signerName={resolvedApprovedName}
                        signDate={record.signatures.approvedBy?.date || record.requestDate}
                        statusLabel="DISETUJUI"
                      />
                    ) : (
                      `[${
                        record.signatures.approvedBy?.status ||
                        'Menunggu Otorisasi Direktur'
                      }]`
                    )}
                  </div>
                  <div className="font-bold underline">{resolvedApprovedName}</div>
                  <div className="text-[12.5px]">{resolvedApprovedRole}</div>
                  <div className="text-[12px] mt-1">
                    Tanggal:{' '}
                    {record.signatures.approvedBy?.date
                      ? formatIndonesianDate(record.signatures.approvedBy.date)
                      : '-'}
                  </div>
                  {record.signatures.approvedBy?.notes && (
                    <div className="text-[12px] italic mt-1">
                      "{record.signatures.approvedBy.notes}"
                    </div>
                  )}
                </td>

                <td className="border border-black px-2.5 py-2 text-center">
                  <div className="min-h-[64px] flex flex-col items-center justify-center italic text-[12px] py-1 gap-1.5">
                    {record.signatures.disbursedBy?.isDisbursed ||
                    record.status === 'Dicairkan' ? (
                      <ApprovalBarcodeStamp
                        documentNumber={record.advanceNumber}
                        roleCode="FM"
                        signerName={resolvedDisbursedName}
                        signDate={record.signatures.disbursedBy?.date || record.requestDate}
                        statusLabel="DIKONFIRMASI & DICAIRKAN"
                      />
                    ) : (
                      <>
                        <span>
                          {record.status === 'Disetujui'
                            ? '[Menunggu Konfirmasi Finance Manager]'
                            : '[Menunggu ACC Direktur]'}
                        </span>
                        {canConfirmDisbursement && (
                          <button
                            type="button"
                            onClick={() =>
                              confirmPanelRef.current?.scrollIntoView({
                                behavior: 'smooth',
                                block: 'center',
                              })
                            }
                            className="not-italic px-2 py-0.5 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-[10.5px] font-sans font-semibold cursor-pointer print:hidden"
                          >
                            Konfirmasi Finance Manager ↑
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  <div className="font-bold underline">{resolvedDisbursedName}</div>
                  <div className="text-[12.5px]">{resolvedDisbursedRole}</div>
                  <div className="text-[12px] mt-1">
                    Tanggal:{' '}
                    {record.signatures.disbursedBy?.date
                      ? formatIndonesianDate(record.signatures.disbursedBy.date)
                      : '-'}
                  </div>
                  {record.signatures.disbursedBy?.transferReference && (
                    <div className="text-[12px] mt-0.5">
                      Ref: {record.signatures.disbursedBy.transferReference}
                    </div>
                  )}
                  {record.signatures.disbursedBy?.notes && (
                    <div className="text-[11.5px] italic mt-0.5">
                      "{record.signatures.disbursedBy.notes}"
                    </div>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </article>

      {/* Bottom Governance Bar for Review/Approval Workflow */}
      <div className="bg-white rounded-md border border-stone-200/80 px-4 py-3 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="text-xs text-stone-600">
          <span>Status Dokumen Cash Advance: </span>
          <strong className="text-stone-900 font-semibold">{record.status}</strong>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(record.status === 'Draft' || record.status === 'Perlu Perbaikan') && (
            <button
              type="button"
              onClick={handleSubmitDraft}
              disabled={actionLoading}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded text-xs font-medium text-white bg-stone-900 hover:bg-stone-800 transition-colors cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Ajukan ke Finance Manager</span>
            </button>
          )}

          {canConfirmDisbursement && (
            <button
              type="button"
              onClick={() => handleFinanceManagerConfirm()}
              disabled={actionLoading}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 transition-colors cursor-pointer disabled:opacity-50"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Konfirmasi &amp; Cairkan (Finance Manager)</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded text-xs font-medium text-stone-700 hover:bg-stone-100 border border-stone-200 transition-colors cursor-pointer"
          >
            {inline ? '← Kembali ke Daftar Cash Advance' : 'Tutup'}
          </button>
        </div>
      </div>
    </div>
  );

  if (inline) {
    return documentContent;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-2xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
    >
      <div className="bg-[#F7F7F5] rounded-lg border border-stone-200 shadow-2xl max-w-5xl w-full max-h-[96vh] flex flex-col overflow-y-auto p-4 sm:p-6 my-auto">
        {documentContent}
      </div>
    </div>
  );
};
