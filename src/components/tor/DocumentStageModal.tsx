import React, { useState } from 'react';
import { Tor, TorDocument, User } from '../../types/index.js';
import { formatIndonesianDate } from '../../lib/dateUtils.js';
import { api } from '../../lib/api.js';
import {
  X,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
  User as UserIcon,
  Calendar,
  Lock,
  Edit3,
  Save,
  ShieldCheck,
  Eye,
} from 'lucide-react';

interface DocumentStageModalProps {
  document: TorDocument;
  tor: Tor;
  currentUser: User | null;
  onClose: () => void;
  onDocumentUpdated?: (updatedDoc: TorDocument) => void;
}

export const DocumentStageModal: React.FC<DocumentStageModalProps> = ({
  document: initialDoc,
  tor,
  currentUser,
  onClose,
  onDocumentUpdated,
}) => {
  const [doc, setDoc] = useState<TorDocument>(initialDoc);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Edit form states
  const [editTitle, setEditTitle] = useState(doc.title);
  const [editSummary, setEditSummary] = useState(doc.summary || '');
  const [editContent, setEditContent] = useState(doc.content || '');

  // Permission checks:
  // Is this TOR fully archived and completed?
  const isArchived = Boolean(tor.isArchivedCompleted || tor.activityStatus === 'Selesai');
  const isDirectorOrAdmin = currentUser?.role === 'director' || currentUser?.role === 'admin';
  const isAuthor = doc.authorId === currentUser?.id;
  const isTorPic = tor.picId === currentUser?.id;
  const isFinance =
    currentUser?.role === 'finance' &&
    (doc.stageKey === 'cash_advance' || doc.stageKey === 'laporan_keuangan');

  // Completed documents in archive can only be modified by director/admin if needed,
  // whereas regular users have strictly shared read-only access.
  const canEdit =
    (!isArchived || isDirectorOrAdmin) &&
    (isAuthor || isTorPic || isFinance || isDirectorOrAdmin) &&
    doc.status !== 'Selesai';

  const handleSave = async () => {
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const updated = await api.updateDocument(doc.id, {
        title: editTitle,
        summary: editSummary,
        content: editContent,
      });
      setDoc(updated);
      setIsEditing(false);
      if (onDocumentUpdated) {
        onDocumentUpdated(updated);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal menyimpan pembaruan dokumen');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-2xs flex items-center justify-center p-4 animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-lg border border-[#E5E5E3] shadow-lg max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-[#F0F0EE] flex items-center justify-between bg-white">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center text-slate-700 font-mono text-xs font-bold shrink-0">
              {String(doc.stageNumber).padStart(2, '0')}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-[#1D4ED8] uppercase tracking-wide">
                  {doc.stageTitle}
                </span>
                <span className="text-[#D4D4D0]">·</span>
                {doc.status === 'Selesai' ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    <span>Selesai</span>
                  </span>
                ) : doc.status === 'Tidak Diperlukan' ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                    <span>Tidak Diperlukan</span>
                  </span>
                ) : doc.status === 'Draft' ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    <Clock className="w-3 h-3 text-amber-600" />
                    <span>Draf</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                    <AlertCircle className="w-3 h-3 text-blue-600" />
                    <span>{doc.status}</span>
                  </span>
                )}
              </div>
              <h2 className="text-[16px] font-bold text-[#171717] mt-0.5 leading-snug">
                {doc.title}
              </h2>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-[#737373] hover:text-[#171717] hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
            aria-label="Tutup dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-[13px] text-[#404040]">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded text-rose-700 text-xs">
              {errorMessage}
            </div>
          )}

          {/* Shared Access Notice Banner */}
          <div className="p-3 bg-[#FAFAFA] rounded-md border border-[#EAEAEA] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
            <div className="flex items-center gap-2 text-[#525252]">
              <Eye className="w-4 h-4 text-[#1D4ED8] shrink-0" />
              <span>
                <strong>Akses Dokumen Bersama:</strong> Dokumen terhubung dengan TOR{' '}
                <span className="font-mono text-[#171717]">{tor.torNumber}</span> dan dapat dilihat bersama oleh pengguna yang memiliki akses program.
              </span>
            </div>
            {doc.status === 'Selesai' ? (
              <span className="inline-flex items-center gap-1 text-emerald-700 font-medium shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Terverifikasi Lengkap</span>
              </span>
            ) : canEdit ? (
              <span className="inline-flex items-center gap-1 text-blue-700 font-medium shrink-0">
                <Edit3 className="w-3.5 h-3.5" />
                <span>Hak Edit Aktif</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-slate-500 font-medium shrink-0">
                <Lock className="w-3.5 h-3.5" />
                <span>Mode Lihat (Read-Only)</span>
              </span>
            )}
          </div>

          {/* Metadata Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs bg-white p-3.5 rounded border border-[#E5E5E3]">
            <div>
              <span className="text-[#737373] block text-[11px]">Nomor Dokumen</span>
              <span className="font-mono font-semibold text-[#171717]">
                {doc.documentNumber || '-'}
              </span>
            </div>
            <div>
              <span className="text-[#737373] block text-[11px]">Penyusun / Penanggung Jawab</span>
              <span className="font-medium text-[#171717]">
                {doc.authorName}
              </span>
              <span className="text-[#737373] text-[11px] block">({doc.authorRole})</span>
            </div>
            <div>
              <span className="text-[#737373] block text-[11px]">Tanggal Pembuatan / Update</span>
              <span className="font-medium text-[#171717]">
                {formatIndonesianDate(doc.updatedAt || doc.createdAt)}
              </span>
            </div>
            <div>
              <span className="text-[#737373] block text-[11px]">Pemeriksa / Verifikator</span>
              {doc.approverName ? (
                <>
                  <span className="font-medium text-emerald-700">
                    {doc.approverName}
                  </span>
                  <span className="text-[#737373] text-[11px] block">
                    {formatIndonesianDate(doc.approvalDate || '')}
                  </span>
                </>
              ) : (
                <span className="text-[#737373] italic">Belum diverifikasi</span>
              )}
            </div>
          </div>

          {/* Metadata Highlights if any (Amounts, Photos count, In-Kind values) */}
          {doc.metadata && Object.keys(doc.metadata).length > 0 && (
            <div className="p-3 bg-blue-50/50 border border-blue-100 rounded text-xs space-y-1">
              <span className="text-[11px] font-bold text-blue-900 uppercase tracking-wider block">
                Atribut Tambahan Tahap {doc.stageTitle}
              </span>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-700">
                {doc.metadata.amount && (
                  <div>
                    <span className="text-slate-500">Nilai Kasbon:</span>{' '}
                    <strong className="text-slate-900">
                      Rp {Number(doc.metadata.amount).toLocaleString('id-ID')}
                    </strong>
                  </div>
                )}
                {doc.metadata.totalRealized && (
                  <div>
                    <span className="text-slate-500">Total Realisasi:</span>{' '}
                    <strong className="text-slate-900">
                      Rp {Number(doc.metadata.totalRealized).toLocaleString('id-ID')}
                    </strong>
                  </div>
                )}
                {doc.metadata.refundAmount !== undefined && (
                  <div>
                    <span className="text-slate-500">Sisa Kasbon Disetor:</span>{' '}
                    <strong className="text-emerald-700">
                      Rp {Number(doc.metadata.refundAmount).toLocaleString('id-ID')}
                    </strong>
                  </div>
                )}
                {doc.metadata.attendeesCount && (
                  <div>
                    <span className="text-slate-500">Jumlah Peserta Hadir:</span>{' '}
                    <strong className="text-slate-900">{doc.metadata.attendeesCount} orang</strong>
                  </div>
                )}
                {doc.metadata.photosCount && (
                  <div>
                    <span className="text-slate-500">Jumlah Berkas Foto:</span>{' '}
                    <strong className="text-slate-900">{doc.metadata.photosCount} seri foto</strong>
                  </div>
                )}
                {doc.metadata.inKindValue && (
                  <div>
                    <span className="text-slate-500">Nilai Swadaya Terverifikasi:</span>{' '}
                    <strong className="text-slate-900">
                      Rp {Number(doc.metadata.inKindValue).toLocaleString('id-ID')}
                    </strong>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Document Content / Edit View */}
          {isEditing ? (
            <div className="space-y-3.5 bg-slate-50 p-4 rounded border border-slate-200">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Judul Dokumen
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Ringkasan / Poin Utama
                </label>
                <input
                  type="text"
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Uraian Isi Dokumen
                </label>
                <textarea
                  rows={6}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded hover:bg-slate-50 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={handleSave}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSaving ? 'Menyimpan...' : 'Simpan Perubahan'}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {doc.summary && (
                <div className="bg-[#FAF9F6] p-3 rounded border border-[#EDECE8]">
                  <span className="text-[11px] font-bold text-[#737373] uppercase tracking-wider block mb-1">
                    Ringkasan Tahapan:
                  </span>
                  <p className="text-xs text-[#262626] leading-relaxed">
                    {doc.summary}
                  </p>
                </div>
              )}

              <div>
                <span className="text-[11px] font-bold text-[#737373] uppercase tracking-wider block mb-1.5">
                  Uraian / Isi Dokumen:
                </span>
                <div className="bg-white p-4 rounded border border-[#E5E5E3] leading-relaxed text-[#262626] whitespace-pre-wrap">
                  {doc.content || (
                    <span className="text-[#8C8C89] italic">
                      Isi dokumen belum diinput atau masih dalam tahap penyusunan.
                    </span>
                  )}
                </div>
              </div>

              {doc.approvalNotes && (
                <div className="p-3 bg-emerald-50/50 rounded border border-emerald-200 text-xs">
                  <span className="text-[11px] font-bold text-emerald-900 block mb-0.5">
                    Catatan Pemeriksa ({doc.approverName}):
                  </span>
                  <p className="text-emerald-800 leading-relaxed italic">
                    "{doc.approvalNotes}"
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-[#F0F0EE] bg-[#FAFAFA] flex items-center justify-between">
          <div className="text-[11px] text-[#737373]">
            {isArchived ? (
              <span className="flex items-center gap-1">
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                Dokumen Arsip Selesai · Tersimpan di basis data terpadu organisasi
              </span>
            ) : (
              <span>Rantai Dokumen Program · Tahap {doc.stageNumber} dari 8</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isEditing && canEdit && (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="px-3 py-1.5 text-xs font-semibold text-[#1D4ED8] bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Edit Dokumen</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-medium text-[#171717] bg-white border border-[#E5E5E3] rounded hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
