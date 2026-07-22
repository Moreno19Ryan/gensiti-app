'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Props {
  kegiatanId: string
  kode: string | null
  onCheckin: (pesan: string, sukses: boolean) => void
}

// Panel kiosk RFID -- dioperasikan Pengurus (bukan self check-in tiap Generus, beda dari
// QR/manual). Reader USB mode "keyboard wedge" mengetik UID kartu + Enter ke input ini;
// begitu Enter ditekan, UID dikirim ke submit_presensi_rfid bersama kode presensi aktif
// sebagai bukti device ini sedang membuka sesi presensi yang sah -- pola otorisasi yang
// sama dengan QR/manual (kode presensi tetap satu-satunya sumber kebenaran), RFID cuma
// cara baru mengidentifikasi generus-nya lewat kartu, bukan jalur otorisasi terpisah.
// Input auto-focus & auto-clear supaya kartu berikutnya bisa langsung di-tap tanpa perlu
// klik apa pun di antaranya.
export default function RfidKioskInput({ kegiatanId, kode, onCheckin }: Props) {
  const [uid, setUid] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = async () => {
    const uidTrimmed = uid.trim()
    if (!uidTrimmed || !kode || loading) return
    setLoading(true)
    setUid('')
    try {
      const { data, error } = await supabase.rpc('submit_presensi_rfid', {
        p_kegiatan_id: kegiatanId,
        p_kode: kode,
        p_kartu_uid: uidTrimmed,
      })
      if (error) throw error
      const nama = data?.nama_lengkap ? ` -- ${data.nama_lengkap}` : ''
      onCheckin(`✓ Absensi tercatat${nama}`, true)
    } catch (e) {
      onCheckin(e instanceof Error ? e.message : 'Gagal membaca kartu.', false)
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="bg-slate-50 rounded-xl p-4 text-center space-y-2">
      <p className="text-xs text-slate-400">Mode Kartu RFID -- tap kartu Generus ke reader</p>
      <input
        ref={inputRef}
        value={uid}
        onChange={e => setUid(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
        placeholder="Tap kartu di sini..."
        disabled={loading}
        className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-mono text-center focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
      />
    </div>
  )
}
