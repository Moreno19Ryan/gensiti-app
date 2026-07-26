'use client'

import { useToasts, tutupToast, JenisToast } from '@/lib/toast'

// Penampil toast -- dipasang SEKALI di app/(dashboard)/layout.tsx. Semua halaman cukup
// memanggil toast.sukses()/gagal()/info() dari lib/toast.ts tanpa perlu tahu komponen ini ada.

const GAYA: Record<JenisToast, { wadah: string; ikonBg: string; ikon: React.ReactNode }> = {
  sukses: {
    wadah: 'border-emerald-200 dark:border-emerald-800',
    ikonBg: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400',
    ikon: <path d="m5 13 4 4L19 7" />,
  },
  gagal: {
    wadah: 'border-red-200 dark:border-red-800',
    ikonBg: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400',
    ikon: <><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></>,
  },
  info: {
    wadah: 'border-blue-200 dark:border-blue-800',
    ikonBg: 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400',
    ikon: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  },
}

export default function ToastHost() {
  const toasts = useToasts()

  if (toasts.length === 0) return null

  return (
    // aria-live="polite" -- pembaca layar mengumumkan toast tanpa memotong apa yang sedang
    // dibaca. Wadahnya SELALU ada di DOM saat ada toast (bukan dibuat/dihapus per-item)
    // supaya pengumumannya konsisten terbaca.
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed z-[60] bottom-4 right-4 left-4 sm:left-auto sm:w-96 flex flex-col-reverse gap-2 pointer-events-none"
    >
      {toasts.map(t => {
        const gaya = GAYA[t.jenis]
        return (
          <div
            key={t.id}
            role={t.jenis === 'gagal' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-2xl border bg-white dark:bg-slate-800 shadow-lg animate-toast-in ${gaya.wadah}`}
          >
            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${gaya.ikonBg}`}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                {gaya.ikon}
              </svg>
            </div>
            <p className="flex-1 text-sm text-slate-700 dark:text-slate-200 leading-snug break-words">{t.pesan}</p>
            <button
              type="button"
              onClick={() => tutupToast(t.id)}
              aria-label="Tutup notifikasi"
              className="shrink-0 w-6 h-6 -mr-1 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700 transition"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        )
      })}
    </div>
  )
}
