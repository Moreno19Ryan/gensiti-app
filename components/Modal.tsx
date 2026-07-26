'use client'

import { ReactNode, useEffect, useId, useRef } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

// Aksesibilitas (role="dialog", aria-modal, focus trap, Escape, kembalikan fokus) MENIRU
// PERSIS pola components/KonfirmasiHost.tsx (dibangun lebih dulu, lihat AUDIT_MENYELURUH_2026-07.md
// §4b) -- modal ini dipakai di ~15 halaman utk form tambah/edit, jadi sebelumnya pengguna
// keyboard terjebak begitu modal terbuka (Tab bisa lolos ke konten di belakang yang secara
// visual tidak terlihat). Beda dgn KonfirmasiHost yang fokus awalnya ke tombol utama, di sini
// fokus awal diarahkan ke PANEL itu sendiri (bukan elemen form tertentu) -- isi modal ini
// bermacam-macam (form input, tabel, dst), jadi tidak ada elemen "default" yang selalu benar.
export default function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const fokusSebelumnya = useRef<HTMLElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return

    fokusSebelumnya.current = document.activeElement as HTMLElement | null
    panelRef.current?.focus()

    document.body.style.overflow = 'hidden'

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab') return

      const fokusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
      document.body.style.overflow = ''
      fokusSebelumnya.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  const sizeClass = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }[size]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in" onClick={onClose} />

      {/* Modal */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full ${sizeClass} max-h-[90vh] flex flex-col animate-dialog-in outline-none`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-700 shrink-0">
          <h2 id={titleId} className="text-lg font-bold text-slate-800 dark:text-slate-100">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Tutup"
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {children}
        </div>
      </div>
    </div>
  )
}
