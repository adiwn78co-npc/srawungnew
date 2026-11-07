import React, { useMemo } from 'react';

interface ApprovalBarcodeStampProps {
  /** Nomor dokumen, misal CA/003.01/WIJNA/PALKL/1.1.2/X/2026 atau TOR/001/... */
  documentNumber?: string;
  /** Kode peran: REQ, FIN, DIR, CSH, REP */
  roleCode: string;
  /** Nama pejabat / penandatangan */
  signerName: string;
  /** Tanggal tanda tangan / persetujuan */
  signDate?: string;
  /** Label status di atas barcode (misal: TELAH DIAJUKAN, TERVERIFIKASI, DISETUJUI, DICAIRKAN) */
  statusLabel?: string;
  /** Ukuran kompak untuk modal kecil */
  compact?: boolean;
  /** Variasi stempel: authorized (biru resmi) atau pending (amber/abu stempel menunggu) */
  variant?: 'authorized' | 'pending';
}

/**
 * Menghasilkan hash deterministik (hex) & pola garis barcode unik dari kombinasi dokumen + penandatangan
 */
function computeDeterministicHash(input: string): number {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return h1 >>> 0;
}

const ENGLISH_MONTHS_SHORT = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

function formatEnglishAuthDate(dateStr?: string): string {
  if (!dateStr || dateStr === '-') {
    return '06 OCT 2026';
  }
  const trimmed = dateStr.trim();

  // YYYY-MM-DD or ISO string
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const year = isoMatch[1];
    const monthIdx = parseInt(isoMatch[2], 10) - 1;
    const day = isoMatch[3];
    const mon = ENGLISH_MONTHS_SHORT[monthIdx] || 'OCT';
    return `${day} ${mon} ${year}`;
  }

  // Indonesian short date e.g. "6 Okt 2026" or "19 Mei 2026"
  const indoMap: Record<string, string> = {
    JAN: 'JAN',
    FEB: 'FEB',
    MAR: 'MAR',
    APR: 'APR',
    MEI: 'MAY',
    MAY: 'MAY',
    JUN: 'JUN',
    JUL: 'JUL',
    AGU: 'AUG',
    AUG: 'AUG',
    SEP: 'SEP',
    OKT: 'OCT',
    OCT: 'OCT',
    NOV: 'NOV',
    DES: 'DEC',
    DEC: 'DEC',
  };

  const parts = trimmed.split(/\s+/);
  if (parts.length >= 3) {
    const day = parts[0].padStart(2, '0');
    const rawMon = parts[1].toUpperCase().slice(0, 3);
    const mon = indoMap[rawMon] || rawMon;
    const year = parts[2];
    return `${day} ${mon} ${year}`;
  }

  return trimmed.toUpperCase();
}

function toEnglishStatusLabel(statusLabel?: string, roleCode?: string, isPending?: boolean): string {
  const raw = (statusLabel || '').toUpperCase();
  const role = (roleCode || '').toUpperCase();

  if (isPending || raw.includes('MENUNGGU') || raw.includes('BELUM')) {
    return raw || 'PENDING AUTHORIZATION';
  }
  if (raw.includes('DIAJUKAN') || role === 'PIC' || role === 'REQ') {
    return 'SUBMITTED & SIGNED';
  }
  if (raw.includes('DILAPORKAN') || role === 'REP') {
    return 'REPORTED & VERIFIED';
  }
  if (raw.includes('FINANCE') || raw.includes('TERVERIFIKASI') || role === 'FIN') {
    return 'VERIFIED BY FINANCE';
  }
  if (raw.includes('DIRECTOR') || raw.includes('DISETUJUI') || role === 'DIR') {
    return 'APPROVED & AUTHORIZED';
  }
  if (raw.includes('DICAIRKAN') || role === 'CSH') {
    return 'DISBURSED & VERIFIED';
  }
  return raw || 'AUTHORIZED SIGNATURE';
}

export const ApprovalBarcodeStamp: React.FC<ApprovalBarcodeStampProps> = ({
  documentNumber = 'DOC',
  roleCode,
  signerName,
  signDate = '',
  statusLabel = 'VERIFIED',
  compact = false,
  variant,
}) => {
  const isPending =
    variant === 'pending' ||
    /menunggu|belum/i.test(statusLabel || '');

  const { uniqueCode, bars, englishStatus, formattedAuthDate } = useMemo(() => {
    const cleanDoc =
      documentNumber
        .replace(/[^A-Z0-9]/gi, '')
        .toUpperCase()
        .slice(0, 6) || 'WIJNA';
    const cleanRole =
      roleCode
        .replace(/[^A-Z0-9]/gi, '')
        .toUpperCase()
        .slice(0, 3) || 'SIG';
    const seedStr = `${documentNumber}|${roleCode}|${signerName}|${signDate}|${isPending ? 'P' : 'A'}`;
    const hashNum = computeDeterministicHash(seedStr);
    const hexSuffix = hashNum.toString(16).toUpperCase().padStart(8, '0').slice(0, 6);
    const code = `${isPending ? 'PND' : 'SIG'}-${cleanDoc}-${cleanRole}-${hexSuffix}`;

    // Buat deretan garis barcode 1D (Code-128 style) yang deterministik dari seed
    const barList: { x: number; width: number; isGuard?: boolean }[] = [];
    let currentX = 2;
    // Start guard bars
    barList.push({ x: currentX, width: 2, isGuard: true });
    currentX += 3.5;
    barList.push({ x: currentX, width: 1, isGuard: true });
    currentX += 2.5;

    let lcg = hashNum || 123456789;
    for (let i = 0; i < 26; i++) {
      lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0;
      const w = (lcg % 3) + 1; // 1, 2, or 3 px
      const gap = ((lcg >>> 4) % 2) + 1.2; // 1.2 or 2.2 px
      barList.push({ x: currentX, width: w });
      currentX += w + gap;
    }

    // End guard bars
    barList.push({ x: currentX, width: 1, isGuard: true });
    currentX += 2.5;
    barList.push({ x: currentX, width: 2, isGuard: true });
    currentX += 2;

    return {
      uniqueCode: code,
      bars: { list: barList, totalWidth: Math.ceil(currentX + 2) },
      englishStatus: toEnglishStatusLabel(statusLabel, roleCode, isPending),
      formattedAuthDate: formatEnglishAuthDate(signDate),
    };
  }, [documentNumber, roleCode, signerName, signDate, statusLabel, isPending]);

  const borderColor = isPending ? 'rgba(217, 119, 6, 0.55)' : 'rgba(37, 99, 235, 0.42)';
  const bgColor = isPending ? 'rgba(254, 243, 199, 0.28)' : 'rgba(219, 234, 254, 0.22)';
  const textColor = isPending ? 'rgba(180, 83, 9, 0.88)' : 'rgba(29, 78, 216, 0.82)';
  const barFill = isPending ? 'rgba(180, 83, 9, 0.55)' : 'rgba(29, 78, 216, 0.68)';

  return (
    <div
      className="inline-flex flex-col items-center justify-center select-none pointer-events-none my-0.5"
      style={{
        transform: 'rotate(-4deg)',
        WebkitPrintColorAdjust: 'exact',
        printColorAdjust: 'exact',
      }}
      title={`Digital Stamp: ${uniqueCode} · ${isPending ? statusLabel : `Authorized: ${formattedAuthDate}`}`}
    >
      <div
        className={`flex flex-col items-center rounded border-2 ${
          isPending ? 'border-dashed' : 'border-solid'
        } ${compact ? 'px-2 py-0.5' : 'px-2.5 py-1'}`}
        style={{
          backgroundColor: bgColor,
          borderColor: borderColor,
        }}
      >
        {/* Top Stamp Status Label */}
        <div
          className="text-[7.5px] font-sans font-extrabold uppercase tracking-wider leading-none mb-0.5 text-center max-w-[145px]"
          style={{ color: textColor }}
        >
          {englishStatus}
        </div>

        {/* Semi-transparent 1D Barcode SVG */}
        <svg
          width={compact ? 116 : 134}
          height={compact ? 18 : 22}
          viewBox={`0 0 ${bars.totalWidth} 28`}
          preserveAspectRatio="none"
          className="overflow-visible"
          aria-label={`Barcode ${uniqueCode}`}
        >
          {bars.list.map((b, idx) => (
            <rect
              key={idx}
              x={b.x}
              y={b.isGuard ? 1 : 2}
              width={b.width}
              height={b.isGuard ? 26 : 23}
              fill={barFill}
              rx={0.3}
            />
          ))}
        </svg>

        {/* Unique Verification Code */}
        <div
          className="font-mono text-[8px] font-bold tracking-wider leading-none mt-0.5"
          style={{ color: textColor }}
        >
          {uniqueCode}
        </div>

        {/* Authorized / Status Footer */}
        <div
          className="font-mono text-[7px] font-semibold tracking-wider uppercase leading-none mt-0.5 pt-0.5 border-t w-full text-center"
          style={{
            color: textColor,
            borderColor: isPending ? 'rgba(217, 119, 6, 0.3)' : 'rgba(59, 130, 246, 0.25)',
          }}
        >
          {isPending ? 'STAMP: WAITING ACTION' : `AUTHORIZED: ${formattedAuthDate}`}
        </div>
      </div>
    </div>
  );
};
