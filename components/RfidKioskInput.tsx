'use client'

import { useEffect, useRef, useState, type FocusEvent } from 'react'
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
export default function RfidKioskInput({ kegiatanId, kode, onCheckin }: Props) {
  const [uid, setUid] = useState('')
  const [loading, setLoading] = useState(false)
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

  // Kalau fokus pindah karena operator SENGAJA mengklik elemen interaktif lain di panel yang
  // sama (tombol "Perbarui kode", "Saya Hadir", dst), biarkan -- jangan rebut fokus supaya
  // klik itu tetap berfungsi. Selain itu (klik area kosong / fokus hilang tanpa sebab jelas),
  // tarik paksa fokus balik supaya reader HID tidak diam-diam kehilangan target ketikan.
  const handleBlur = (e: FocusEvent<HTMLInputElement>) => {
    setFocused(false)
    const nextTarget = e.relatedTarget as HTMLElement | null
    const pindahKeElemenInteraktif = nextTarget?.tagName === 'BUTTON' || nextTarget?.tagName === 'A'
    if (pindahKeElemenInteraktif) return
    refocusTimer.current = setTimeout(() => inputRef.current?.focus(), 100)
  }

  const handleSubmit = async () => {
    const uidTrimmed = uid.trim()
    if (!uidTrimmed || !kode || loading) return
    setLoading(true)
    setUid('')
    try {
      // p_waktu_scan diambil SAAT INI (bukan saat flush nanti) -- lihat catatan sama di
      // PresensiPanel.tsx.
      const hasil = await submitPresensiOffline('submit_presensi_rfid', {
        p_kegiatan_id: kegiatanId,
        p_kode: kode,
        p_kartu_uid: uidTrimmed,
        p_waktu_scan: new Date().toISOString(),
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
    <div className="relative">
      {/* Input asli tetap di DOM & bisa menerima fokus (display:none/visibility:hidden ditolak
          browser untuk difokuskan) -- disembunyikan lewat opacity-0 & ditumpuk di atas seluruh
          kartu status (absolute inset-0), supaya klik di MANA PUN pada kartu ini memfokuskan
          input, bukan cuma kotak kecil seperti sebelumnya. */}
      <input
        ref={inputRef}
        value={uid}
        onChange={e => setUid(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        disabled={loading}
        autoComplete="off"
        aria-label="Input kartu RFID"
        className="absolute inset-0 z-10 w-full h-full opacity-0 cursor-default disabled:cursor-wait"
      />
      <div className={`rounded-xl p-4 text-center border-2 transition-colors ${
        focused ? 'bg-green-50 border-green-400' : 'bg-amber-50 border-amber-400 animate-pulse'
      }`}>
        <p className={`text-sm font-semibold ${focused ? 'text-green-700' : 'text-amber-700'}`}>
          {focused ? '🟢 Kiosk siap -- tap kartu Generus ke reader' : '⚠️ Kiosk terjeda -- klik kartu ini untuk lanjut'}
        </p>
        {jumlahAntrean > 0 && (
          <p className="text-[11px] text-amber-600 mt-1">📶 {jumlahAntrean} antrean menunggu sinkronisasi</p>
        )}
      </div>
    </div>
  )
}
