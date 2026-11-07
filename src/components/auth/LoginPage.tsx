import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { User } from '../../types/index.js';
import {
  Lock,
  User as UserIcon,
  Eye,
  EyeOff,
  AlertCircle,
  ArrowRight,
  Loader2,
} from 'lucide-react';

interface LoginPageProps {
  onLoginSuccess?: (user: User) => void;
}

/**
 * Ilustrasi Doodle Animasi Ringan: "Gotong Royong Orang Bekerja di Kantor"
 * Menggambarkan rekan-rekan satu kantor yang saling bahu-membahu di meja kerja bersama,
 * menyusun papan strategi/Kanban, berdiskusi dengan laptop & dokumen kerja,
 * dalam suasana ruang kantor yang hangat, dinamis, dan harmonis.
 */
const GotongRoyongOfficeDoodle: React.FC = () => {
  return (
    <div className="relative w-full max-w-2xl mx-auto select-none">
      <style>{`
        @keyframes officeFloatSlow {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-6px) rotate(1deg); }
        }
        @keyframes officeFloatReverse {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(5px) rotate(-1deg); }
        }
        @keyframes officePulseGlow {
          0%, 100% { transform: scale(1); opacity: 0.88; }
          50% { transform: scale(1.05); opacity: 1; }
        }
        @keyframes officeDashFlow {
          to { stroke-dashoffset: -28; }
        }
        @keyframes officeSteam {
          0%, 100% { transform: translateY(0px); opacity: 0.45; }
          50% { transform: translateY(-5px); opacity: 0.9; }
        }
        .office-float-1 { animation: officeFloatSlow 5.2s ease-in-out infinite; }
        .office-float-2 { animation: officeFloatReverse 6s ease-in-out infinite; }
        .office-float-3 { animation: officeFloatSlow 4.5s ease-in-out infinite 0.8s; }
        .office-pulse { animation: officePulseGlow 4s ease-in-out infinite; transform-origin: center; }
        .office-dash { animation: officeDashFlow 3.2s linear infinite; }
        .office-steam { animation: officeSteam 2.8s ease-in-out infinite; }
      `}</style>

      <svg
        viewBox="0 0 660 500"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-auto max-h-[24dvh] md:max-h-none mx-auto drop-shadow-xs"
        role="img"
        aria-label="Ilustrasi Doodle Gotong Royong Orang Bekerja di Kantor WIJNA SRAWUNG"
      >
        {/* Latar Ruang Kantor Organik Cerita Warna (Warm Cream, Soft Sage, Amber Glow) */}
        <path
          d="M75 260C65 135 165 52 330 52C495 52 595 135 585 260C575 375 495 442 330 442C165 442 85 375 75 260Z"
          fill="#FFFDF8"
          stroke="#E7DFCC"
          strokeWidth="2.2"
          strokeDasharray="7 7"
        />

        {/* Karpet Lantai Kantor Hangat */}
        <ellipse cx="330" cy="422" rx="268" ry="34" fill="#DCEFE6" />
        <ellipse cx="330" cy="426" rx="210" ry="20" fill="#C4E4D5" />

        {/* Lampu Gantung Kantor Modern di Tengah Atas + Pancaran Cahaya Hangat */}
        <g className="office-pulse">
          <path d="M330 32V74" stroke="#263238" strokeWidth="2.6" strokeLinecap="round" />
          <path
            d="M294 94C294 78 310 70 330 70C350 70 366 78 366 94H294Z"
            fill="#F59E0B"
            stroke="#263238"
            strokeWidth="2.6"
            strokeLinejoin="round"
          />
          <path
            d="M276 96L245 162H415L384 96H276Z"
            fill="#FEF3C7"
            fillOpacity="0.55"
          />
          <circle cx="330" cy="96" r="6" fill="#FDE68A" stroke="#263238" strokeWidth="2" />
        </g>

        {/* Jam Dinding Kantor (Kiri Atas) */}
        <g className="office-float-1">
          <circle
            cx="138"
            cy="118"
            r="26"
            fill="#FFFFFF"
            stroke="#263238"
            strokeWidth="2.6"
          />
          <circle cx="138" cy="118" r="20" stroke="#E2E8F0" strokeWidth="1.8" />
          <path
            d="M138 106V118L147 123"
            stroke="#0F7B6C"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>

        {/* PAPAN KANBAN & STRATEGI KANTOR (Dinding Tengah-Kiri) */}
        <g className="office-float-2">
          <rect
            x="186"
            y="108"
            width="156"
            height="98"
            rx="10"
            fill="#FFFFFF"
            stroke="#263238"
            strokeWidth="2.8"
          />
          <rect
            x="186"
            y="108"
            width="156"
            height="22"
            rx="8"
            fill="#0F7B6C"
            stroke="#263238"
            strokeWidth="2.6"
          />
          <circle cx="200" cy="119" r="3" fill="#FDE68A" />
          <circle cx="211" cy="119" r="3" fill="#6EE7B7" />
          <path d="M226 119H292" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" />

          {/* Kolom Kanban & Sticky Notes */}
          <path d="M238 134V198M290 134V198" stroke="#E2E8F0" strokeWidth="2" strokeDasharray="3 3" />
          {/* Sticky Note 1 (Kuning) */}
          <rect
            x="198"
            y="140"
            width="30"
            height="22"
            rx="3"
            fill="#FDE047"
            stroke="#263238"
            strokeWidth="2"
          />
          {/* Sticky Note 2 (Coral/Terracotta) */}
          <rect
            x="198"
            y="168"
            width="30"
            height="22"
            rx="3"
            fill="#FDBA74"
            stroke="#263238"
            strokeWidth="2"
          />
          {/* Sticky Note 3 (Biru di kolom In Progress) */}
          <rect
            x="248"
            y="142"
            width="32"
            height="24"
            rx="3"
            fill="#93C5FD"
            stroke="#263238"
            strokeWidth="2"
          />
          {/* Sticky Note 4 (Hijau di kolom Done) */}
          <rect
            x="300"
            y="142"
            width="30"
            height="24"
            rx="3"
            fill="#6EE7B7"
            stroke="#263238"
            strokeWidth="2"
          />
          <path
            d="M309 154L314 159L323 149"
            stroke="#263238"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>

        {/* PAPAN GRAFIK & CAPAIAN TIM (Dinding Kanan Atas) */}
        <g className="office-float-3">
          <rect
            x="372"
            y="114"
            width="116"
            height="86"
            rx="10"
            fill="#FFFBEB"
            stroke="#263238"
            strokeWidth="2.6"
          />
          {/* Bar Chart Naik */}
          <rect x="390" y="166" width="14" height="20" rx="2" fill="#60A5FA" stroke="#263238" strokeWidth="2" />
          <rect x="412" y="154" width="14" height="32" rx="2" fill="#34D399" stroke="#263238" strokeWidth="2" />
          <rect x="434" y="140" width="14" height="46" rx="2" fill="#F59E0B" stroke="#263238" strokeWidth="2" />
          <rect x="456" y="128" width="14" height="58" rx="2" fill="#0F7B6C" stroke="#263238" strokeWidth="2" />
          <path
            d="M392 152L418 140L440 128L464 119"
            stroke="#E11D48"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </g>

        {/* Garis Alur Sinergi & Gotong Royong Antar Rekan Kantor */}
        <path
          d="M145 255C210 212 275 210 330 232C385 210 450 212 515 255"
          stroke="#0F7B6C"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeDasharray="6 6"
          className="office-dash"
        />

        {/* ==================== 4 REKAN KERJA GOTONG ROYONG DI KANTOR ==================== */}

        {/* REKAN 1 (KIRI): Staf Program Bekerja dengan Laptop & Menyerahkan Dokumen Rencana */}
        <g className="office-float-1">
          {/* Kursi Kerja Kiri */}
          <path
            d="M116 322H158V376H116V322Z"
            fill="#334155"
            stroke="#263238"
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          {/* Kaki */}
          <path
            d="M142 362L136 420M162 362L170 420"
            stroke="#263238"
            strokeWidth="3.4"
            strokeLinecap="round"
          />
          {/* Badan (Kemeja Terracotta / Amber Hangat) */}
          <path
            d="M126 278C126 262 138 252 154 252C170 252 182 262 184 278L188 346H122L126 278Z"
            fill="#FB923C"
            stroke="#263238"
            strokeWidth="2.8"
            strokeLinejoin="round"
          />
          {/* Kerah Kemeja & Lanyard ID Card Kantor */}
          <path d="M145 253L154 266L163 253" stroke="#263238" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M148 256L154 286L160 256" stroke="#FFFBEB" strokeWidth="2" />
          <rect x="149" y="286" width="10" height="14" rx="2" fill="#FDE047" stroke="#263238" strokeWidth="1.8" />
          {/* Kepala & Senyum */}
          <circle cx="155" cy="222" r="22" fill="#FDE68A" stroke="#263238" strokeWidth="2.8" />
          <path
            d="M134 216C136 196 172 194 177 214"
            fill="#1E293B"
            stroke="#263238"
            strokeWidth="2.4"
          />
          {/* Kacamata Kerja */}
          <circle cx="150" cy="221" r="5" fill="#FFFFFF" stroke="#263238" strokeWidth="2" />
          <circle cx="164" cy="221" r="5" fill="#FFFFFF" stroke="#263238" strokeWidth="2" />
          <path d="M155 221H159" stroke="#263238" strokeWidth="2" />
          <path d="M150 232C154 235 160 235 164 232" stroke="#263238" strokeWidth="2.2" strokeLinecap="round" />
          {/* Lengan Mengulurkan Map Dokumen ke Rekan Tengah */}
          <path
            d="M174 282L224 294"
            stroke="#263238"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          {/* Map Dokumen Kolaborasi */}
          <rect
            x="214"
            y="274"
            width="36"
            height="26"
            rx="4"
            transform="rotate(-8 214 274)"
            fill="#FDE047"
            stroke="#263238"
            strokeWidth="2.4"
          />
        </g>

        {/* REKAN 2 (TENGAH-KIRI): Berdiri Menyusun Strategi & Mengkoordinasikan Tim */}
        <g className="office-float-3">
          {/* Kaki */}
          <path
            d="M268 352L262 420M288 352L294 420"
            stroke="#263238"
            strokeWidth="3.4"
            strokeLinecap="round"
          />
          {/* Badan (Blazer / Baju Kantor Biru Cerah) */}
          <path
            d="M252 268C252 254 264 244 278 244C292 244 304 254 304 268L308 346H248L252 268Z"
            fill="#38BDF8"
            stroke="#263238"
            strokeWidth="2.8"
            strokeLinejoin="round"
          />
          {/* Lanyard ID Card */}
          <path d="M272 246L278 276L284 246" stroke="#FFFFFF" strokeWidth="2" />
          <rect x="273" y="276" width="10" height="13" rx="2" fill="#FFFFFF" stroke="#263238" strokeWidth="1.8" />
          {/* Kepala & Hijab/Rambut Rapi */}
          <circle cx="278" cy="216" r="21" fill="#FDE68A" stroke="#263238" strokeWidth="2.8" />
          <path
            d="M257 214C258 192 298 192 299 214C300 226 293 236 286 239"
            stroke="#263238"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <circle cx="273" cy="215" r="2.2" fill="#263238" />
          <circle cx="285" cy="215" r="2.2" fill="#263238" />
          <path d="M273 224C276 227 282 227 285 224" stroke="#263238" strokeWidth="2.2" strokeLinecap="round" />
          {/* Lengan Kiri Menerima Map, Lengan Kanan Menunjuk Ide Bersama */}
          <path
            d="M256 278L234 288M298 274L332 292"
            stroke="#263238"
            strokeWidth="3.4"
            strokeLinecap="round"
          />
        </g>

        {/* REKAN 3 (TENGAH-KANAN): Berdiskusi & Mengecek Data Tablet Bersama */}
        <g className="office-float-2">
          {/* Kaki */}
          <path
            d="M372 352L366 420M392 352L398 420"
            stroke="#263238"
            strokeWidth="3.4"
            strokeLinecap="round"
          />
          {/* Badan (Kemeja Sage / Emerald Kantor) */}
          <path
            d="M356 268C356 254 368 244 382 244C396 244 408 254 408 268L412 346H352L356 268Z"
            fill="#34D399"
            stroke="#263238"
            strokeWidth="2.8"
            strokeLinejoin="round"
          />
          {/* Dasi / Kerah Kantor */}
          <path d="M382 248L378 276L382 282L386 276L382 248Z" fill="#0F2B5C" stroke="#263238" strokeWidth="1.8" />
          {/* Kepala */}
          <circle cx="382" cy="216" r="21" fill="#FDE68A" stroke="#263238" strokeWidth="2.8" />
          <path
            d="M362 208C366 192 398 192 402 208Z"
            fill="#263238"
            stroke="#263238"
            strokeWidth="2.2"
          />
          <circle cx="376" cy="215" r="2.2" fill="#263238" />
          <circle cx="388" cy="215" r="2.2" fill="#263238" />
          <path d="M376 224C379 227 385 227 388 224" stroke="#263238" strokeWidth="2.2" strokeLinecap="round" />
          {/* Lengan Memegang Tablet / Clipboard Kerja Bersama */}
          <path
            d="M360 276L336 292M404 278L434 294"
            stroke="#263238"
            strokeWidth="3.4"
            strokeLinecap="round"
          />
        </g>

        {/* REKAN 4 (KANAN): Staf Bekerja di Laptop & Menata Berkas Tim */}
        <g className="office-float-1">
          {/* Kursi Kerja Kanan */}
          <path
            d="M502 322H544V376H502V322Z"
            fill="#334155"
            stroke="#263238"
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          {/* Kaki */}
          <path
            d="M494 362L486 420M516 362L524 420"
            stroke="#263238"
            strokeWidth="3.4"
            strokeLinecap="round"
          />
          {/* Badan (Kemeja Ungu Lavender / Indigo Lembut) */}
          <path
            d="M476 278C478 262 490 252 506 252C522 252 534 262 534 278L538 346H472L476 278Z"
            fill="#A78BFA"
            stroke="#263238"
            strokeWidth="2.8"
            strokeLinejoin="round"
          />
          {/* Lanyard ID Card */}
          <path d="M500 254L506 284L512 254" stroke="#FEF3C7" strokeWidth="2" />
          <rect x="501" y="284" width="10" height="13" rx="2" fill="#6EE7B7" stroke="#263238" strokeWidth="1.8" />
          {/* Kepala */}
          <circle cx="505" cy="222" r="22" fill="#FDE68A" stroke="#263238" strokeWidth="2.8" />
          <path
            d="M484 216C486 196 524 196 526 218"
            fill="#1E293B"
            stroke="#263238"
            strokeWidth="2.4"
          />
          <circle cx="498" cy="221" r="2.2" fill="#263238" />
          <circle cx="510" cy="221" r="2.2" fill="#263238" />
          <path d="M498 231C502 234 508 234 512 231" stroke="#263238" strokeWidth="2.2" strokeLinecap="round" />
          {/* Lengan Mengetik & Berkolaborasi ke Meja Tengah */}
          <path
            d="M484 284L444 304M518 286L472 312"
            stroke="#263238"
            strokeWidth="3.4"
            strokeLinecap="round"
          />
        </g>

        {/* ==================== MEJA KERJA KOLABORASI KANTOR (SHARED OFFICE DESK) ==================== */}
        <g>
          {/* Permukaan Meja Kayu Hangat */}
          <rect
            x="114"
            y="334"
            width="432"
            height="18"
            rx="7"
            fill="#F59E0B"
            stroke="#263238"
            strokeWidth="2.8"
          />
          {/* Kaki Meja Kantor */}
          <path
            d="M148 352V424M512 352V424M245 352V420M415 352V420"
            stroke="#263238"
            strokeWidth="3.6"
            strokeLinecap="round"
          />
          <path d="M136 424H524" stroke="#263238" strokeWidth="3" strokeLinecap="round" />

          {/* Laptop Kiri di Atas Meja */}
          <path
            d="M152 296H204L210 334H158L152 296Z"
            fill="#E2E8F0"
            stroke="#263238"
            strokeWidth="2.6"
            strokeLinejoin="round"
          />
          <circle cx="181" cy="315" r="4.5" fill="#0F7B6C" />
          <rect x="150" y="330" width="66" height="5" rx="2" fill="#64748B" stroke="#263238" strokeWidth="2" />

          {/* Monitor / Dokumen Sinergi di Tengah Meja */}
          <rect
            x="292"
            y="286"
            width="76"
            height="42"
            rx="6"
            fill="#FFFFFF"
            stroke="#263238"
            strokeWidth="2.6"
          />
          <rect x="298" y="292" width="64" height="10" rx="2" fill="#A7F3D0" />
          <path d="M300 310H344M300 318H330" stroke="#0F2B5C" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M330 328V334M316 334H344" stroke="#263238" strokeWidth="2.8" strokeLinecap="round" />

          {/* Laptop Kanan di Atas Meja */}
          <path
            d="M450 296H502L496 334H444L450 296Z"
            fill="#E2E8F0"
            stroke="#263238"
            strokeWidth="2.6"
            strokeLinejoin="round"
          />
          <circle cx="473" cy="315" r="4.5" fill="#F59E0B" />
          <rect x="438" y="330" width="66" height="5" rx="2" fill="#64748B" stroke="#263238" strokeWidth="2" />

          {/* Cangkir Kopi / Teh Hangat + Uap di Meja */}
          <rect
            x="252"
            y="314"
            width="18"
            height="20"
            rx="3"
            fill="#FB7185"
            stroke="#263238"
            strokeWidth="2.2"
          />
          <path d="M270 318H274C276 318 277 320 277 322C277 324 276 326 274 326H270" stroke="#263238" strokeWidth="2" />
          <path
            d="M258 308C258 303 261 301 260 297M265 308C265 303 268 301 267 297"
            stroke="#64748B"
            strokeWidth="2"
            strokeLinecap="round"
            className="office-steam"
          />

          {/* Tumpukan Buku / Binder Dokumen di Meja */}
          <rect x="392" y="322" width="34" height="12" rx="2" fill="#38BDF8" stroke="#263238" strokeWidth="2.2" />
          <rect x="396" y="311" width="30" height="11" rx="2" fill="#FDE047" stroke="#263238" strokeWidth="2.2" />
        </g>

        {/* Tanaman Indoor Kantor (Kiri & Kanan) */}
        <g className="office-float-2">
          {/* Pot Kiri */}
          <path
            d="M72 384H106L100 422H78L72 384Z"
            fill="#F97316"
            stroke="#263238"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <path
            d="M89 384C74 366 72 344 84 334C92 346 92 368 89 384Z"
            fill="#10B981"
            stroke="#263238"
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          <path
            d="M89 384C104 368 110 348 98 338C90 348 88 368 89 384Z"
            fill="#34D399"
            stroke="#263238"
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
        </g>

        <g className="office-float-3">
          {/* Pot Kanan */}
          <path
            d="M554 384H588L582 422H560L554 384Z"
            fill="#0F7B6C"
            stroke="#263238"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <path
            d="M571 384C556 366 554 344 566 334C574 346 574 368 571 384Z"
            fill="#34D399"
            stroke="#263238"
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          <path
            d="M571 384C586 368 592 348 580 338C572 348 570 368 571 384Z"
            fill="#6EE7B7"
            stroke="#263238"
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
        </g>

        {/* Bintang & Sparkle Kolaborasi */}
        <g className="office-pulse">
          <path
            d="M158 164L162 173L171 177L162 181L158 190L154 181L145 177L154 173L158 164Z"
            fill="#F59E0B"
            stroke="#263238"
            strokeWidth="1.8"
          />
          <path
            d="M518 162L521 170L529 173L521 176L518 184L515 176L507 173L515 170L518 162Z"
            fill="#10B981"
            stroke="#263238"
            strokeWidth="1.8"
          />
        </g>
      </svg>
    </div>
  );
};

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const { login } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedId = identifier.trim();
    if (!trimmedId) {
      setErrorMessage('Please enter your username.');
      return;
    }
    if (!password) {
      setErrorMessage('Please enter your password.');
      return;
    }

    setSubmitting(true);
    try {
      const authenticatedUser = await login(trimmedId, password);
      if (onLoginSuccess) {
        onLoginSuccess(authenticatedUser);
      }
    } catch (err: any) {
      setErrorMessage(
        err?.message || 'Authentication failed. Please check your username and password.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{ fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif" }}
      className="h-[100dvh] max-h-[100dvh] w-full bg-gradient-to-br from-[#FFFDF9] via-[#F3FAF6] to-[#FEF5E7] text-[#252525] flex items-center justify-center px-4 py-3 sm:px-6 sm:py-4 md:p-8 lg:p-12 antialiased relative overflow-hidden"
    >
      {/* Ornamen Cerita Warna Lembut di Latar Belakang */}
      <div className="pointer-events-none absolute -top-28 -left-28 w-[28rem] h-[28rem] rounded-full bg-[#A7F3D0]/40 blur-3xl" />
      <div className="pointer-events-none absolute top-1/4 -right-28 w-[26rem] h-[26rem] rounded-full bg-[#FDE68A]/45 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 left-1/3 w-[26rem] h-[26rem] rounded-full bg-[#BAE6FD]/35 blur-3xl" />

      {/* Kontainer Utama Full-Page Proporsional (Tampilan Web 2 Kolom di PC) */}
      <div className="relative z-10 w-full max-w-6xl mx-auto flex flex-col md:grid md:grid-cols-12 gap-3 sm:gap-4 md:gap-8 lg:gap-12 items-center justify-center max-h-full">
        {/* SISI KIRI: Ilustrasi Doodle Animasi Ringan Gotong Royong Orang Bekerja di Kantor */}
        <div className="md:col-span-7 w-full flex flex-col items-center justify-center shrink-0">
          <div className="w-full max-w-[260px] sm:max-w-[300px] md:max-w-2xl mx-auto">
            <GotongRoyongOfficeDoodle />
          </div>
        </div>

        {/* SISI KANAN: Box Login Luwes & Hangat dengan WIJNA SRAWUNG di Dalam Box */}
        <div className="md:col-span-5 w-full max-w-[400px] md:max-w-[440px] mx-auto shrink-0">
          {/* KARTU UTAMA LOGIN (Judul WIJNA SRAWUNG berada tepat di dalam Box) */}
          <div className="relative bg-white/95 backdrop-blur-xl rounded-[24px] md:rounded-[28px] border border-[#E8E2D5] shadow-[0_20px_50px_-15px_rgba(15,43,92,0.08)] overflow-hidden transition-all">
            {/* Dekorasi Cahaya Lembut di Dalam Box */}
            <div className="pointer-events-none absolute -top-16 -right-16 w-36 h-36 rounded-full bg-[#FEF3C7]/60 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-16 -left-16 w-36 h-36 rounded-full bg-[#D1FAE5]/50 blur-2xl" />

            <div className="relative p-5 sm:p-6 md:p-8 space-y-4 md:space-y-6">
              {/* Header Judul WIJNA SRAWUNG di Dalam Box dengan Tipografi Karakter Hangat & Elegan */}
              <div className="text-center pb-2 border-b border-[#F1EDE4]">
                <h1
                  style={{ fontFamily: "'Fraunces', 'Outfit', Georgia, serif" }}
                  className="text-xl sm:text-2xl md:text-[30px] font-bold tracking-tight bg-gradient-to-r from-[#0F2B5C] via-[#0F7B6C] to-[#B45309] bg-clip-text text-transparent"
                >
                  WIJNA SRAWUNG
                </h1>
              </div>

              {/* Validation / Error Message */}
              {errorMessage && (
                <div className="p-3 rounded-2xl bg-rose-50/90 border border-rose-200 text-xs text-rose-800 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <div className="font-semibold text-rose-900">Sign In Failed</div>
                    <p className="text-rose-700 leading-relaxed">{errorMessage}</p>
                  </div>
                </div>
              )}

              {/* Login Input Form */}
              <form onSubmit={handleSubmit} className="space-y-3.5 md:space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="login-identifier"
                    className="block text-xs font-semibold text-[#37352F] pl-0.5"
                  >
                    Username
                  </label>
                  <div className="relative group">
                    <UserIcon className="w-4 h-4 text-[#8E8B82] group-focus-within:text-[#1A73E8] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none transition-colors" />
                    <input
                      id="login-identifier"
                      type="text"
                      autoComplete="username"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      disabled={submitting}
                      placeholder="Enter your username"
                      className="w-full pl-11 pr-4 py-2.5 md:py-3 text-xs sm:text-sm border border-[#E4DFD3] rounded-2xl bg-[#FCFBF9] hover:bg-white focus:bg-white text-[#252525] placeholder:text-[#A39E93] focus:outline-none focus:border-[#1A73E8] focus:ring-4 focus:ring-[#1A73E8]/15 transition-all disabled:bg-[#F7F7F5]"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="login-password"
                    className="block text-xs font-semibold text-[#37352F] pl-0.5"
                  >
                    Password
                  </label>
                  <div className="relative group">
                    <Lock className="w-4 h-4 text-[#8E8B82] group-focus-within:text-[#1A73E8] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none transition-colors" />
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={submitting}
                      placeholder="Enter your password"
                      className="w-full pl-11 pr-11 py-2.5 md:py-3 text-xs sm:text-sm border border-[#E4DFD3] rounded-2xl bg-[#FCFBF9] hover:bg-white focus:bg-white text-[#252525] placeholder:text-[#A39E93] focus:outline-none focus:border-[#1A73E8] focus:ring-4 focus:ring-[#1A73E8]/15 transition-all disabled:bg-[#F7F7F5]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      tabIndex={-1}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1.5 text-[#8E8B82] hover:text-[#252525] rounded-xl hover:bg-[#F3EFE6] transition-colors cursor-pointer"
                      title={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="pt-0.5 md:pt-1">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-2.5 md:py-3 px-5 rounded-2xl bg-[#1A73E8] hover:bg-[#1557B0] active:bg-[#174EA6] text-white text-xs sm:text-sm font-semibold shadow-[0_10px_24px_-8px_rgba(26,115,232,0.45)] hover:shadow-[0_14px_28px_-8px_rgba(26,115,232,0.55)] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Signing in...</span>
                      </>
                    ) : (
                      <>
                        <span>Sign In</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
