'use client'

import { useEffect, useRef } from 'react'
import { useKonfirmasi, jawabKonfirmasi } from '@/lib/konfirmasi'

// Penampil dialog konfirmasi -- dipasang SEKALI di app/(dashboard)/layout.tsx.
//
// Aksesibilitasnya SENGAJA dibuat lengkap di sini (role="dialog", aria-modal, focus trap,
// Escape, kembalikan fokus saat ditutup) -- tiga hal yang justru belum dimiliki
// components/Modal.tsx. Ini melengkapi kerja B4 (Ukuran Teks & Kontras Tinggi): percuma
// membantu pengguna dengan keterbatasan penglihatan kalau pengguna keyboard justru
// terjebak begitu dialog terbuka. Pola di file ini dimaksudkan jadi rujukan saat
// Modal.tsx dibenahi menyusul.

export default function KonfirmasiHost() {
  const state = useKonfirmasi()
  const panelRef = useRef<HTMLDivElement>(null)
  const tombolYaRef = useRef<HTMLButtonElement>(null)
  // Elemen yang tadinya fokus sebelum dialog dibuka -- dikembalikan saat ditutup supaya
  // pengguna keyboard tidak "terlempar" ke awal halaman setelah menjawab.
  const fokusSebelumnya = useRef<HTMLElement | null>(null)

  const terbuka = !!state

  useEffect(() => {
    if (!terbuka) return

    fokusSebelumnya.current = document.activeElement as HTMLElement | null
    // Fokus ke tombol utama, bukan ke tombol Batal -- pengguna keyboard bisa langsung
    // Enter untuk aksi yang memang dia niatkan saat mengklik.
    tombolYaRef.current?.focus()

    const sebelumnyaOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        jawabKonfirmasi(false)
        return
      }
      if (e.key !== 'Tab') return

      // Focus trap: putar fokus di dalam panel supaya Tab tidak lolos ke konten di
      // belakang dialog (yang secara visual tidak bisa diakses tapi tetap fokusable).
      const fokusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (!fokusable || fokusable.length === 0) return
      const pertama = fokusable[0]
      const terakhir = fokusable[fokusable.length - 1]

      if (e.shiftKey && document.activeElement === pertama) {
        e.preventDefault()
        terakhir.focus()
      } else if (!e.shiftKey && document.activeElement === terakhir) {
        e.preventDefault()
        pertama.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = sebelumnyaOverflow
      fokusSebelumnya.current?.focus?.()
    }
    // `state.id` ikut jadi dependency supaya focus trap di-setup ulang kalau dialog
    // berganti isi tanpa sempat tertutup.
  }, [terbuka, state?.id])

  if (!state) return null

  const {
    judul,
    pesan,
    labelYa = 'Ya, Lanjutkan',
    labelBatal = 'Batal',
    destruktif = false,
  } = state

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
        onClick={() => jawabKonfirmasi(false)}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="konfirmasi-judul"
        aria-describedby="konfirmasi-pesan"
        className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-dialog-in"
      >
        <div className="flex flex-col items-center text-center">
          <div
            className={`w-12 h-12 rounded-full flex items-center justify-center mb-3 ${
              destruktif
                ? 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'
                : 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
            }`}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              {destruktif ? (
                <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>
              ) : (
                <><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></>
              )}
            </svg>
          </div>

          <h2 id="konfirmasi-judul" className="font-bold text-slate-800 dark:text-slate-100 text-base">
            {judul || (destruktif ? 'Yakin ingin melanjutkan?' : 'Konfirmasi')}
          </h2>
          <p id="konfirmasi-pesan" className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
            {pesan}
          </p>
        </div>

        <div className="flex gap-3 mt-5">
          <button
            type="button"
            onClick={() => jawabKonfirmasi(false)}
            className="flex-1 py-2.5 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition"
          >
            {labelBatal}
          </button>
          <button
            ref={tombolYaRef}
            type="button"
            onClick={() => jawabKonfirmasi(true)}
            className={`flex-1 py-2.5 text-white rounded-xl text-sm font-semibold transition ${
              destruktif ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {labelYa}
          </button>
        </div>
      </div>
    </div>
  )
}
