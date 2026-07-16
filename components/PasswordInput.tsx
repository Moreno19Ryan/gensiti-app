'use client'

import { useEffect, useRef, useState } from 'react'

// Input password dgn dua mode tampilan:
//  1. Mode default (mata tertutup) -- <input type="password"> NATIVE, browser yang
//     melakukan masking sepenuhnya (selalu benar, tidak pernah kita sentuh/rekonstruksi
//     value-nya). Sbg umpan balik visual tambahan, karakter yang BARU SAJA diketik muncul
//     sesaat (~700ms) di badge kecil di bawah field (bukan di dalam field itu sendiri),
//     lalu badge hilang otomatis -- meniru rasa "tahu apa yang baru diketik" ala keyboard
//     HP tanpa pernah mengubah cara <input> menyimpan/menampilkan value aslinya.
//  2. Mode "lihat semua" (klik ikon mata) -- <input> di-toggle jadi type="text" (masih
//     input NATIVE yang sama, cuma atributnya berubah), value tampil apa adanya.
//
// KENAPA DITULIS ULANG (bug besar yang diperbaiki, dilaporkan user 2026-07-14): versi
// sebelumnya pakai <input type="text"> dgn value hasil masking manual ('•••1' dst) sbg
// controlled value, lalu mencoba menebak-nebak "karakter apa yg baru diketik" dari
// e.target.value yang browser kirim -- padahal e.target.value itu SENDIRI sudah berisi
// campuran bullet + huruf baru (krn value <input>-nya memang teks ber-mask, bukan value
// asli). Akibatnya karakter '•' bisa ikut tersimpan sungguhan ke dalam password state
// begitu user mengetik cukup panjang, membuat value yang dikirim ke server BERBEDA dari
// yang diketik user -- padahal tampilan terakhir yang terlihat (huruf yg sedang di-reveal
// sesaat) tetap terlihat benar, sehingga user tidak melihat ada yang salah sampai login
// ditolak. Pendekatan baru ini TIDAK PERNAH merekonstruksi atau menebak value dari teks
// yang sudah di-mask -- <input> selalu memegang & mengembalikan value asli apa adanya
// (persis seperti <input type="password"> di web manapun), jadi kelas bug ini terhapus
// secara struktural, bukan sekadar ditambal.
//
// Value asli tetap dikelola oleh parent (controlled component, sama seperti <input> biasa)
// -- komponen ini hanya menambahkan UI toggle show/hide + badge preview di atasnya.
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

const PREVIEW_DURATION_MS = 700

export default function PasswordInput({
  value, onChange, placeholder, id, name, autoComplete, className, disabled,
}: Props) {
  const [revealAll, setRevealAll] = useState(false)
  // Karakter terakhir yang baru diketik, ditampilkan sesaat di badge preview lalu di-clear
  // otomatis -- MURNI tampilan tambahan di luar <input>, tidak pernah memengaruhi value asli.
  const [previewChar, setPreviewChar] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Panjang value sebelumnya -- dipakai murni utk mendeteksi "apakah ini penambahan
  // karakter baru" (utk keputusan tampilkan badge preview atau tidak), TIDAK dipakai utk
  // merekonstruksi value (beda dari pendekatan lama yg jadi sumber bug).
  const prevLengthRef = useRef(value.length)

  // Bersihkan timer saat unmount supaya tidak setState pada komponen yang sudah hilang.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Value asli diambil LANGSUNG dari <input> native (type="password" atau "text"),
    // dikirim ke parent apa adanya -- tidak ada transformasi/masking/rekonstruksi apapun
    // di jalur ini, sehingga tidak mungkin ada karakter asing (mis. bullet) yang menyusup.
    const newValue = e.target.value
    onChange(newValue)

    if (timerRef.current) clearTimeout(timerRef.current)

    // Tampilkan badge preview HANYA saat penambahan murni 1+ karakter di akhir (mengetik
    // maju yg paling umum) -- kasus lain (hapus, edit di tengah, paste, autofill) sengaja
    // tidak memicu badge supaya tidak menampilkan potongan yg membingungkan/salah konteks.
    const isSimpleAppend = newValue.length > prevLengthRef.current && newValue.startsWith(value)
    if (isSimpleAppend && !revealAll) {
      setPreviewChar(newValue[newValue.length - 1])
      timerRef.current = setTimeout(() => setPreviewChar(null), PREVIEW_DURATION_MS)
    } else {
      setPreviewChar(null)
    }
    prevLengthRef.current = newValue.length
  }

  return (
    <div className="relative">
      <input
        type={revealAll ? 'text' : 'password'}
        id={id}
        name={name}
        autoComplete={autoComplete}
        disabled={disabled}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        className={className}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => { setRevealAll(v => !v); setPreviewChar(null) }}
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

      {/* Badge preview karakter terakhir -- murni lapisan visual di LUAR <input>, posisinya
          tidak bergantung pada lebar font/zoom sehingga tidak pernah meleset. Hanya tampil
          sesaat di mode default (bukan mode "lihat semua", yg sudah menampilkan semuanya). */}
      {previewChar && !revealAll && (
        <span
          aria-hidden="true"
          className="absolute -bottom-6 right-0 text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md font-mono pointer-events-none select-none animate-pulse"
        >
          ...{previewChar}
        </span>
      )}
    </div>
  )
}
