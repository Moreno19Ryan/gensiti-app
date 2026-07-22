'use client'

import { useEffect, useRef, useState } from 'react'
import { submitPresensiOffline, getJumlahAntrean } from '@/lib/offline-queue'

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
  // Reader HID cuma "mengetik" ke elemen yang sedang fokus -- kalau operator sempat mengklik
  // elemen lain (mis. tombol "Perbarui kode"/"Saya Hadir" di panel yang sama), ketikan kartu
  // berikutnya akan terbuang sia-sia tanpa kartu tsb kelihatan "gagal" sama sekali (diam-diam
  // hilang). `focused` menggerakkan indikator visual, refocusTimer mengembalikan fokus
  // otomatis TAPI ditunda sedikit (bukan sinkron) supaya klik ke tombol lain di layar yang
  // sama sempat selesai diproses dulu sebelum fokus direbut balik.
  const [focused, setFocused] = useState(true)
  const [jumlahAntrean, setJumlahAntrean] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const refocusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    return () => { if (refocusTimer.current) clearTimeout(refocusTimer.current) }
  }, [])

  useEffect(() => {
    let cancelled = false
    const refresh = () => getJumlahAntrean().then((n) => { if (!cancelled) setJumlahAntrean(n) })
    refresh()
    const interval = setInterval(refresh, 5000)
    window.addEventListener('online', refresh)
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener('online', refresh) }
  }, [])

  const handleBlur = () => {
    setFocused(false)
    refocusTimer.current = setTimeout(() => inputRef.current?.focus(), 100)
  }

  const handleSubmit = async () => {
    const uidTrimmed = uid.trim()
    if (!uidTrimmed || !kode || loading) return
    setLoading(true)
    setUid('')
    try {
      const hasil = await submitPresensiOffline('submit_presensi_rfid', {
        p_kegiatan_id: kegiatanId,
        p_kode: kode,
        p_kartu_uid: uidTrimmed,
      })
      if (hasil.error) throw new Error(hasil.error)
      if (hasil.queued) {
        setJumlahAntrean((n) => n + 1)
        onCheckin('📶 Sinyal terputus -- absensi disimpan & akan otomatis terkirim saat online kembali.', true)
      } else {
        const data = hasil.data as { nama_lengkap?: string } | undefined
        const nama = data?.nama_lengkap ? ` -- ${data.nama_lengkap}` : ''
        onCheckin(`✓ Absensi tercatat${nama}`, true)
      }
    } catch (e) {
      onCheckin(e instanceof Error ? e.message : 'Gagal membaca kartu.', false)
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className={`rounded-xl p-4 text-center space-y-2 border transition-colors ${
      focused ? 'bg-green-50 border-green-200' : 'bg-slate-100 border-slate-300'
    }`}>
      <p className={`text-xs font-medium ${focused ? 'text-green-700' : 'text-slate-500'}`}>
        {focused ? '🟢 Siap menerima kartu -- tap kartu Generus ke reader' : '⚪ Klik kotak di bawah untuk mulai'}
      </p>
      <input
        ref={inputRef}
        value={uid}
        onChange={e => setUid(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        placeholder="Tap kartu di sini..."
        disabled={loading}
        className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-mono text-center focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
      />
      {jumlahAntrean > 0 && (
        <p className="text-[11px] text-amber-600">📶 {jumlahAntrean} antrean menunggu sinkronisasi</p>
      )}
    </div>
  )
}
