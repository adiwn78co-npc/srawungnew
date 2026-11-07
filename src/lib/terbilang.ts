/**
 * Indonesian Number to Words Converter (Fungsi Terbilang Angka Rupiah)
 * Converts numbers like 14750000 into "Empat Belas Juta Tujuh Ratus Lima Puluh Ribu Rupiah"
 */

const ANGKA = [
  '',
  'Satu',
  'Dua',
  'Tiga',
  'Empat',
  'Lima',
  'Enam',
  'Tujuh',
  'Delapan',
  'Sembilan',
  'Sepuluh',
  'Sebelas',
];

function bilanganKeKata(nilai: number): string {
  nilai = Math.floor(Math.abs(nilai));

  if (nilai < 12) {
    return ANGKA[nilai];
  } else if (nilai < 20) {
    return bilanganKeKata(nilai - 10) + ' Belas';
  } else if (nilai < 100) {
    const sisa = nilai % 10;
    return (
      bilanganKeKata(Math.floor(nilai / 10)) +
      ' Puluh' +
      (sisa > 0 ? ' ' + bilanganKeKata(sisa) : '')
    );
  } else if (nilai < 200) {
    const sisa = nilai - 100;
    return 'Seratus' + (sisa > 0 ? ' ' + bilanganKeKata(sisa) : '');
  } else if (nilai < 1000) {
    const sisa = nilai % 100;
    return (
      bilanganKeKata(Math.floor(nilai / 100)) +
      ' Ratus' +
      (sisa > 0 ? ' ' + bilanganKeKata(sisa) : '')
    );
  } else if (nilai < 2000) {
    const sisa = nilai - 1000;
    return 'Seribu' + (sisa > 0 ? ' ' + bilanganKeKata(sisa) : '');
  } else if (nilai < 1000000) {
    const sisa = nilai % 1000;
    return (
      bilanganKeKata(Math.floor(nilai / 1000)) +
      ' Ribu' +
      (sisa > 0 ? ' ' + bilanganKeKata(sisa) : '')
    );
  } else if (nilai < 1000000000) {
    const sisa = nilai % 1000000;
    return (
      bilanganKeKata(Math.floor(nilai / 1000000)) +
      ' Juta' +
      (sisa > 0 ? ' ' + bilanganKeKata(sisa) : '')
    );
  } else if (nilai < 1000000000000) {
    const sisa = nilai % 1000000000;
    return (
      bilanganKeKata(Math.floor(nilai / 1000000000)) +
      ' Miliar' +
      (sisa > 0 ? ' ' + bilanganKeKata(sisa) : '')
    );
  } else if (nilai < 1000000000000000) {
    const sisa = nilai % 1000000000000;
    return (
      bilanganKeKata(Math.floor(nilai / 1000000000000)) +
      ' Triliun' +
      (sisa > 0 ? ' ' + bilanganKeKata(sisa) : '')
    );
  }

  return nilai.toString();
}

export function angkaKeTerbilangRupiah(nominal: number): string {
  if (nominal === 0 || !nominal || isNaN(nominal)) {
    return 'Nol Rupiah';
  }

  const hasilKata = bilanganKeKata(nominal).trim();
  // Standardize multiple spaces and append "Rupiah"
  const bersih = hasilKata.replace(/\s+/g, ' ');
  return `${bersih} Rupiah`;
}

export function formatRupiah(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return 'Rp 0';
  }
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
