'use client'

import Link from 'next/link'

// Header ringkas ala gaya Settings mobile (panah kembali + judul) yang dipakai di semua
// halaman /profil/* -- TIDAK sticky (beda dari topbar global di app/(dashboard)/layout.tsx
// yang sudah sticky sendiri) supaya tidak menumpuk dua bar sticky sekaligus di layar sempit.
export default function ProfilHeader({ title, backHref }: { title: string; backHref: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <Link
        href={backHref}
        className="w-9 h-9 -ml-1.5 flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700 transition shrink-0"
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </Link>
      <h1 className="font-bold text-slate-800 dark:text-white text-[15px]">{title}</h1>
    </div>
  )
}
