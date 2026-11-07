import React, { useState } from 'react';
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
  record,
  currentUser,
  onRefresh,
  onEdit,
  inline = false,
}) => {
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  if (!isOpen || !record) return null;

  const handleSubmitDraft = async () => {
    setActionLoading(true);
    setErrorMsg(null);
    try {
      await api.submitCashAdvance(record.id);
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal mengajukan kasbon');
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
            <span>Dana Telah Dicairkan</span>
          </span>
        );
      case 'Disetujui':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-blue-50 text-blue-800 font-medium text-xs border border-blue-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
            <span>Disetujui (Siap Dicairkan)</span>
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

      {/* Banner Status: Setelah Disetujui Direktur -> Menunggu Pencairan Finance ke Pengaju */}
      {record.status === 'Disetujui' && (
        <div className="px-4 py-3 bg-blue-50/90 border border-blue-200 rounded-md text-xs flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex items-start gap-2.5 text-blue-950">
            <CheckCircle2 className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">
                Telah Disetujui oleh Direktur ({record.signatures.approvedBy?.name || 'Direktur'}) — Menunggu Pencairan Dana oleh Finance
              </div>
              <div className="text-[11px] text-blue-800 mt-0.5">
                Selanjutnya Finance mencairkan dana sebesar <strong>{formatRupiah(record.totalAmount)}</strong> ke rekening pengaju (<strong>{record.requesterName}</strong> · {record.bankName} {record.bankAccountNumber} a.n. {record.bankAccountHolder}) melalui menu <strong>Approval</strong>.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Banner Status: Dana Telah Dicairkan oleh Finance ke Pengaju */}
      {record.status === 'Dicairkan' && (
        <div className="px-4 py-3 bg-emerald-50/90 border border-emerald-200 rounded-md text-xs flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex items-start gap-2.5 text-emerald-950">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">
                Dana Telah Dicairkan oleh Finance ({record.signatures.disbursedBy?.name || 'Ratna Sari'}) &amp; Notifikasi Telah Dikirim ke Pengaju ({record.requesterName})
              </div>
              <div className="text-[11px] text-emerald-800 mt-0.5">
                Transfer ke <strong>{record.bankName}</strong> ({record.bankAccountNumber} a.n. {record.bankAccountHolder}) · Tanggal:{' '}
                <strong>
                  {record.signatures.disbursedBy?.date
                    ? formatIndonesianDate(record.signatures.disbursedBy.date)
                    : '-'}
                </strong>
                {record.signatures.disbursedBy?.transferReference
                  ? ` · Ref Transfer: ${record.signatures.disbursedBy.transferReference}`
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
                  2. Diperiksa Oleh (Finance)
                </th>
                <th className="w-1/4 border border-black px-2.5 py-1.5 font-bold text-center">
                  3. Disetujui Oleh (Executive Director)
                </th>
                <th className="w-1/4 border border-black px-2.5 py-1.5 font-bold text-center">
                  4. Dicairkan Oleh (Kasir / Finance)
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
                        signerName={
                          record.signatures.verifiedBy?.name || 'Budi Hartono, S.E.'
                        }
                        signDate={record.signatures.verifiedBy?.date || record.requestDate}
                        statusLabel="TERVERIFIKASI"
                      />
                    ) : (
                      `[${
                        record.signatures.verifiedBy?.status ||
                        'Menunggu Verifikasi Finance'
                      }]`
                    )}
                  </div>
                  <div className="font-bold underline">
                    {record.signatures.verifiedBy?.name || 'Budi Hartono, S.E.'}
                  </div>
                  <div className="text-[12.5px]">Finance Specialist</div>
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
                        signerName={
                          record.signatures.approvedBy?.name || 'Dr. Hendra Wijaya'
                        }
                        signDate={record.signatures.approvedBy?.date || record.requestDate}
                        statusLabel="DISETUJUI"
                      />
                    ) : (
                      `[${
                        record.signatures.approvedBy?.status ||
                        'Pending'
                      }]`
                    )}
                  </div>
                  <div className="font-bold underline">
                    {record.signatures.approvedBy?.name || 'Dr. Hendra Wijaya'}
                  </div>
                  <div className="text-[12.5px]">Executive Director</div>
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
                        roleCode="CSH"
                        signerName={record.signatures.disbursedBy?.name || 'Ratna Sari'}
                        signDate={record.signatures.disbursedBy?.date || record.requestDate}
                        statusLabel="DICAIRKAN"
                      />
                    ) : (
                      <span>
                        {record.status === 'Disetujui'
                          ? '[Siap Dicairkan Finance]'
                          : '[Belum Dicairkan]'}
                      </span>
                    )}
                  </div>
                  <div className="font-bold underline">
                    {record.signatures.disbursedBy?.name || 'Ratna Sari'}
                  </div>
                  <div className="text-[12.5px]">Kasir / Finance Officer</div>
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
              <span>Ajukan ke Finance</span>
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
