'use client'

import { useEffect, useRef, useState } from 'react'

// Input password dgn dua mode tampilan (mirip keyboard HP):
//  1. Mode default (mata tertutup) -- huruf yang BARU SAJA diketik terlihat sesaat (~700ms),
//     lalu otomatis ikut di-mask jadi bullet (•) seperti huruf lain. Ini beda dari
//     <input type="password"> native yang selalu masking semua karakter dari awal.
//  2. Mode "lihat semua" (klik ikon mata) -- seluruh password tampil jelas selama ikon
//     ditekan/aktif, sampai user klik lagi utk kembali ke mode default.
//
// Value asli tetap dikelola oleh parent (controlled component, sama seperti <input> biasa)
// -- komponen ini hanya mengubah CARA MENAMPILKAN value tsb, bukan menyimpan state terpisah.
// Dipakai di app/login/page.tsx, app/(dashboard)/profil/page.tsx (3x), dan
// app/(dashboard)/generus/page.tsx supaya kelima field password di aplikasi konsisten.

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  id?: string
  name?: string
  autoComplete?: string
  className?: string
  disabled?: boolean
}

const REVEAL_DURATION_MS = 700

export default function PasswordInput({
  value, onChange, placeholder, id, name, autoComplete, className, disabled,
}: Props) {
  const [revealAll, setRevealAll] = useState(false)
  // Index karakter terakhir yang sedang "terlihat sesaat" (posisi di dalam `value`), atau
  // null kalau tidak ada karakter yang sedang di-reveal sementara.
  const [revealIndex, setRevealIndex] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Bersihkan timer saat unmount supaya tidak setState pada komponen yang sudah hilang.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    onChange(newValue)

    if (timerRef.current) clearTimeout(timerRef.current)

    // Hanya reveal sesaat kalau ini penambahan karakter (mengetik maju), bukan hapus/paste --
    // reveal karakter di posisi akhir value baru.
    if (newValue.length > 0 && newValue.length >= value.length) {
      const idx = newValue.length - 1
      setRevealIndex(idx)
      timerRef.current = setTimeout(() => setRevealIndex(null), REVEAL_DURATION_MS)
    } else {
      setRevealIndex(null)
    }
  }

  // Bangun teks tampilan: semua karakter jadi '•', KECUALI karakter di revealIndex (kalau ada
  // dan mode default/bukan revealAll) yang ditampilkan aslinya.
  const displayValue = revealAll
    ? value
    : value
        .split('')
        .map((ch, i) => (i === revealIndex ? ch : '•'))
        .join('')

  return (
    <div className="relative">
      <input
        type="text"
        inputMode="text"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        id={id}
        name={name}
        autoComplete={autoComplete}
        disabled={disabled}
        value={displayValue}
        onChange={handleChange}
        placeholder={placeholder}
        className={className}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setRevealAll(v => !v)}
        disabled={disabled}
        aria-label={revealAll ? 'Sembunyikan password' : 'Tampilkan password'}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition disabled:opacity-50"
      >
        {revealAll ? (
          // Mata dicoret -- sedang menampilkan semua (klik utk sembunyikan)
          <svg className="w-4.5 h-4.5" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.774 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
          </svg>
        ) : (
          // Mata terbuka -- sedang mode default/tersembunyi (klik utk tampilkan semua)
          <svg className="w-4.5 h-4.5" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        )}
      </button>
    </div>
  )
}
