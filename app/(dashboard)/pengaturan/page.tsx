'use client'

import { useDarkMode } from '@/lib/dark-mode'
import { useTextSize, useHighContrast, TextSize } from '@/lib/accessibility'

const APP_VERSION = '0.1.0'

const TEXT_SIZE_OPTIONS: { value: TextSize; label: string; caption: string; previewClass: string }[] = [
  { value: 'normal', label: 'A', caption: 'Normal', previewClass: 'text-sm' },
  { value: 'besar', label: 'A', caption: 'Besar', previewClass: 'text-base' },
  { value: 'lebih-besar', label: 'A', caption: 'Lebih Besar', previewClass: 'text-lg' },
]

// Menu "Pengaturan" -- konsolidasi preferensi tampilan & aksesibilitas aplikasi, dipisah dari
// halaman Profil (yang isinya murni data akun pribadi) sesuai permintaan Reno. Mode Gelap
// dipindah ke sini dari app/(dashboard)/profil/page.tsx (tetap pakai hook yang sama,
// lib/dark-mode.ts, jadi toggle di sini/ikon topbar/halaman lama manapun tetap sinkron
// real-time). Ganti Bahasa & Versi Aplikasi juga dipindah dari kartu "Tentang" di Profil ke
// sini supaya tidak ada 2 tempat berbeda utk pengaturan yang sama.
export default function PengaturanPage() {
  const [darkMode, toggleDarkMode] = useDarkMode()
  const [textSize, setTextSize] = useTextSize()
  const [highContrast, toggleHighContrast] = useHighContrast()

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div>
        <h2 className="font-bold text-slate-800 dark:text-slate-100">Pengaturan</h2>
        <p className="text-slate-400 text-sm">Sesuaikan tampilan dan preferensi aplikasi</p>
      </div>

      {/* Kartu Tampilan & Aksesibilitas */}
      <div>
        <p className="text-[12px] font-bold text-slate-400 uppercase tracking-wide px-1.5 pb-2">Tampilan & Aksesibilitas</p>
        <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-[18px] divide-y divide-slate-100 dark:divide-slate-700 overflow-hidden">
          {/* Mode Gelap */}
          <div className="flex items-center gap-3 px-4 py-3.5">
            <div className="w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0 bg-[#F0EBFB] dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" /></svg>
            </div>
            <span className="flex-1 text-sm font-semibold text-slate-800 dark:text-slate-100">Mode Gelap</span>
            <button
              type="button" onClick={toggleDarkMode}
              aria-label={darkMode ? 'Matikan Mode Gelap' : 'Aktifkan Mode Gelap'}
              className={`shrink-0 relative w-11 h-6 rounded-full transition-colors ${darkMode ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${darkMode ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* Ukuran Teks */}
          <div className="px-4 py-3.5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0 bg-[#EAF4FF] dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 7V4h16v3M9 20h6M12 4v16" /></svg>
              </div>
              <span className="flex-1 text-sm font-semibold text-slate-800 dark:text-slate-100">Ukuran Teks</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {TEXT_SIZE_OPTIONS.map(opt => (
                <button
                  key={opt.value} type="button" onClick={() => setTextSize(opt.value)}
                  aria-pressed={textSize === opt.value}
                  className={`py-2.5 rounded-xl border transition flex flex-col items-center gap-0.5 ${
                    textSize === opt.value
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  <span className={`font-bold ${opt.previewClass}`}>{opt.label}</span>
                  <span className="text-[10px] font-medium">{opt.caption}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Kontras Tinggi */}
          <div className="flex items-center gap-3 px-4 py-3.5">
            <div className="w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0 bg-[#E9F5EC] dark:bg-green-900/30 text-green-600 dark:text-green-400">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor" /></svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Kontras Tinggi</p>
              <p className="text-xs text-slate-400 mt-0.5">Pertajam warna teks dan garis batas antar elemen</p>
            </div>
            <button
              type="button" onClick={toggleHighContrast}
              aria-label={highContrast ? 'Matikan Kontras Tinggi' : 'Aktifkan Kontras Tinggi'}
              className={`shrink-0 relative w-11 h-6 rounded-full transition-colors ${highContrast ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${highContrast ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Kartu Aplikasi */}
      <div>
        <p className="text-[12px] font-bold text-slate-400 uppercase tracking-wide px-1.5 pb-2">Aplikasi</p>
        <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-[18px] divide-y divide-slate-100 dark:divide-slate-700 overflow-hidden">
          {/* Bahasa -- placeholder, belum ada fitur multi-bahasa (aplikasi ini sepenuhnya
              berbahasa Indonesia). Ditampilkan disabled dgn badge "Segera Hadir" drpd
              dihilangkan total, sesuai keputusan produk. */}
          <div className="flex items-center gap-3 px-4 py-3.5 cursor-default">
            <div className="w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9Z" /></svg>
            </div>
            <span className="flex-1 text-sm font-semibold text-slate-400 dark:text-slate-500">Ganti Bahasa</span>
            <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 dark:bg-slate-700 dark:text-slate-400 px-2 py-0.5 rounded-full">Segera Hadir</span>
          </div>

          <div className="flex items-center gap-3 px-4 py-3.5">
            <div className="w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 4 5v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V5l-8-3Z" /></svg>
            </div>
            <span className="flex-1 text-sm font-semibold text-slate-800 dark:text-slate-100">Versi Aplikasi</span>
            <span className="text-[13px] text-slate-400 font-semibold">{APP_VERSION}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
