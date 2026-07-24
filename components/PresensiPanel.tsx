'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Kegiatan } from '@/lib/types'
import { canManagePresensi, isPPG } from '@/lib/roles'
import { UserProfile } from '@/lib/types'
import QRCode from 'qrcode'
import QrScanner from 'qr-scanner'
import { RFID_PRESENSI_READY } from '@/lib/rfid'
import RfidKioskInput from './RfidKioskInput'
import { submitPresensiOffline, getJumlahAntrean } from '@/lib/offline-queue'

interface Props {
  kegiatan: Kegiatan
  user: UserProfile | null
  onUpdated?: (kegiatan: Kegiatan) => void
}

const KODE_MASA_BERLAKU_MS = 5 * 60 * 1000

// Payload yang di-encode ke dalam QR -- menyertakan id kegiatan supaya kamera Generus bisa
// menolak lebih awal (pesan jelas) kalau salah scan QR kegiatan lain, sebelum submit_presensi
// (yang tetap jadi sumber kebenaran otorisasi & validasi di sisi server) dipanggil.
type QrPayload = { v: 1; kegiatanId: string; kode: string }

function buildQrPayload(kegiatanId: string, kode: string): string {
  const payload: QrPayload = { v: 1, kegiatanId, kode }
  return JSON.stringify(payload)
}

function parseQrPayload(raw: string): QrPayload | null {
  try {
    const data = JSON.parse(raw)
    if (data && typeof data === 'object' && data.v === 1 && typeof data.kegiatanId === 'string' && typeof data.kode === 'string') {
      return data as QrPayload
    }
  } catch {
    // Bukan JSON valid -- mungkin QR lain yang tidak terkait GENSITI sama sekali.
  }
  return null
}

// Panel presensi untuk kartu kegiatan yang sedang berlangsung (status = 'ongoing').
// - Ketua/Wakil Ketua & Sekretaris: bisa "Mulai Presensi" -> menampilkan QR code besar yang
//   otomatis diperbarui (rotasi) setiap 5 menit sampai ditutup manual. Mereka sendiri juga
//   wajib presensi (Ketua/Wapon/Sekretaris tetap Generus/pengurus muda-mudi) -- begitu kode
//   aktif, tombol "Saya Hadir" muncul di bawahnya supaya kehadiran mereka ikut tercatat
//   tanpa perlu scan QR sendiri.
// - Generus biasa & pengurus lain (Bendahara, Kemandirian, dll): scan QR yang ditampilkan
//   pengurus lewat kamera HP untuk self check-in. Kalau kamera tidak tersedia/ditolak,
//   tersedia fallback input kode 6 digit manual (kode yang sama yang di-encode dalam QR).
// - Super Admin: BUKAN keduanya -- dia bukan Generus organisasi (tidak boleh muncul di
//   presensi/rekap kegiatan manapun, sejak audit peran) dan tidak lagi berwenang mengelola
//   presensi (read-only, sejak audit peran Super Admin). Ditangani terpisah di bawah,
//   sebelum canOpenPresensi dicek, supaya tidak jatuh ke form self check-in.
export default function PresensiPanel({ kegiatan, user, onUpdated }: Props) {
  const isSuperAdmin = user?.role?.tingkatan === 'super_admin'
  const canOpenPresensi = canManagePresensi(user)
  const [kode, setKode] = useState<string | null>(kegiatan.kode_presensi_aktif)
  const [expiredAt, setExpiredAt] = useState<string | null>(kegiatan.kode_presensi_expired_at)
  // Lazy init supaya render pertama sudah akurat (bukan 0) kalau kode presensi sudah aktif
  // dari prop `kegiatan` -- effect "Hitung mundur" di bawah tetap jadi sumber update tiap
  // detik selanjutnya, ini hanya memperbaiki nilai awal sebelum effect pertama sempat jalan.
  const [sisaDetik, setSisaDetik] = useState<number>(() => {
    if (!kegiatan.kode_presensi_expired_at) return 0
    return Math.max(0, Math.floor((new Date(kegiatan.kode_presensi_expired_at).getTime() - Date.now()) / 1000))
  })
  const [loadingAksi, setLoadingAksi] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [inputKode, setInputKode] = useState('')
  const [modeInputManual, setModeInputManual] = useState(false)
  const [statusCheckin, setStatusCheckin] = useState<'idle' | 'sukses' | 'gagal'>('idle')
  const [pesanCheckin, setPesanCheckin] = useState<string | null>(null)
  const [sudahHadir, setSudahHadir] = useState(false)
  const [loadingCheckinSendiri, setLoadingCheckinSendiri] = useState(false)
  const [scannerAktif, setScannerAktif] = useState(false)
  const [scannerError, setScannerError] = useState<string | null>(null)
  const [jumlahAntrean, setJumlahAntrean] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scannerRef = useRef<QrScanner | null>(null)

  // Diturunkan dari `sisaDetik` (bukan memanggil Date.now() langsung saat render) supaya
  // render tetap pure -- sisaDetik sendiri sudah disinkronkan tiap detik oleh effect
  // "Hitung mundur" di bawah, jadi ini tetap real-time tanpa melanggar aturan purity.
  const isAktif = !!kode && !!expiredAt && sisaDetik > 0

  // Cek apakah Generus/pengurus yang login sudah tercatat hadir untuk kegiatan ini
  const cekStatusKehadiran = useCallback(async () => {
    if (!user) return
    const { data: generus } = await supabase.from('generus').select('id').eq('user_id', user.id).maybeSingle()
    if (!generus) return
    const { data: absen } = await supabase
      .from('absensi')
      .select('status')
      .eq('kegiatan_id', kegiatan.id)
      .eq('generus_id', generus.id)
      .maybeSingle()
    setSudahHadir(absen?.status === 'hadir')
  }, [user, kegiatan.id])

  // Data-fetching on mount/dependency-change (bukan derived state) -- lihat catatan serupa
  // di dashboard/page.tsx. Disable per-baris supaya perilaku persis sama.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cekStatusKehadiran()
  }, [cekStatusKehadiran])

  // Tampilkan jumlah antrean presensi offline (lib/offline-queue.ts) -- polling ringan (cuma
  // baca IndexedDB, bukan network) supaya badge "X antrean" ikut turun begitu flushAntrean
  // global (lib/user-context.tsx) berhasil mengirim ulang saat online kembali.
  useEffect(() => {
    let cancelled = false
    const refresh = () => getJumlahAntrean().then((n) => { if (!cancelled) setJumlahAntrean(n) })
    refresh()
    const interval = setInterval(refresh, 5000)
    window.addEventListener('online', refresh)
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener('online', refresh) }
  }, [])

  // Hitung mundur tampilan detik -- setSisaDetik(0) di sini menyinkronkan dgn `expiredAt`
  // yang hilang/null (external signal), bukan derived state dari props/state React lain.
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (!expiredAt) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSisaDetik(0)
      return
    }
    const tick = () => {
      const sisa = Math.max(0, Math.floor((new Date(expiredAt).getTime() - Date.now()) / 1000))
      setSisaDetik(sisa)
    }
    tick()
    timerRef.current = setInterval(tick, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [expiredAt])

  // Render ulang gambar QR setiap kali kode aktif berganti (baik saat pertama dibuka maupun
  // rotasi otomatis tiap 5 menit) -- generate sebagai data URL PNG di sisi client, tidak
  // perlu request ke server terpisah.
  useEffect(() => {
    if (!kode || !expiredAt || !isAktif || !kegiatan.presensi_metode_qr) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQrDataUrl(null)
      return
    }
    let cancelled = false
    QRCode.toDataURL(buildQrPayload(kegiatan.id, kode), { width: 260, margin: 1 })
      .then((url) => { if (!cancelled) setQrDataUrl(url) })
      .catch(() => { if (!cancelled) setQrDataUrl(null) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kode, expiredAt, kegiatan.id, kegiatan.presensi_metode_qr])

  const mulaiAtauRotasiPresensi = useCallback(async () => {
    setLoadingAksi(true)
    setErrorMsg(null)
    try {
      const { data, error } = await supabase.rpc('generate_kode_presensi', { p_kegiatan_id: kegiatan.id })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      if (row) {
        setKode(row.kode)
        setExpiredAt(row.expired_at)
        onUpdated?.({ ...kegiatan, kode_presensi_aktif: row.kode, kode_presensi_expired_at: row.expired_at })
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Gagal membuka absensi.')
    } finally {
      setLoadingAksi(false)
    }
  }, [kegiatan, onUpdated])

  // Auto-rotasi kode setiap 5 menit selama pengurus sudah membuka sesi presensi ini,
  // supaya layar/HP yang dibiarkan terbuka otomatis menampilkan QR terbaru.
  useEffect(() => {
    if (!canOpenPresensi || !isAktif) return
    const rotasi = setInterval(() => {
      mulaiAtauRotasiPresensi()
    }, KODE_MASA_BERLAKU_MS)
    return () => clearInterval(rotasi)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canOpenPresensi, isAktif])

  // Titik-buta-offline: kalau koneksi putus saat presensi (rentan terjadi di lokasi acara
  // dengan sinyal lemah), submitPresensiOffline menyimpan permintaan ke antrean lokal
  // (IndexedDB) alih-alih langsung gagal -- otomatis dikirim ulang saat online lagi (lihat
  // lib/user-context.tsx). `queued: true` di sini TETAP dianggap sukses dari sudut pandang
  // Generus (kartunya sudah "dipegang" sistem), bukan error yang perlu di-retry manual.
  const submitCheckinDenganKode = async (kodeUntukDikirim: string): Promise<{ queued: boolean }> => {
    // p_waktu_scan diambil SAAT INI (bukan saat flush nanti) -- supaya waktu_absen yang
    // tercatat di database tetap waktu generus benar-benar tap/scan, bukan waktu antrean
    // akhirnya berhasil disinkronkan (bisa selisih lama kalau sinyal lama pulih).
    const hasil = await submitPresensiOffline('submit_presensi', {
      p_kegiatan_id: kegiatan.id,
      p_kode: kodeUntukDikirim,
      p_waktu_scan: new Date().toISOString(),
    })
    if (hasil.error) throw new Error(hasil.error)
    if (hasil.queued) setJumlahAntrean((n) => n + 1)
    return { queued: hasil.queued }
  }

  const submitCheckin = async () => {
    if (inputKode.trim().length !== 6) {
      setStatusCheckin('gagal')
      setPesanCheckin('Kode harus 6 digit.')
      return
    }
    setLoadingAksi(true)
    setStatusCheckin('idle')
    setPesanCheckin(null)
    try {
      const { queued } = await submitCheckinDenganKode(inputKode.trim())
      setStatusCheckin('sukses')
      setPesanCheckin(queued
        ? 'Sinyal terputus -- absensi disimpan di perangkat & akan otomatis terkirim saat online kembali.'
        : 'Absensi berhasil dicatat. Terima kasih!')
      setSudahHadir(true)
      setInputKode('')
    } catch (e) {
      setStatusCheckin('gagal')
      setPesanCheckin(e instanceof Error ? e.message : 'Gagal melakukan absensi.')
    } finally {
      setLoadingAksi(false)
    }
  }

  // Dipanggil saat kamera berhasil membaca QR -- divalidasi dulu formatnya & kecocokan
  // kegiatan di sisi client (supaya pesan error jelas & cepat), otorisasi & validasi kode
  // sebenarnya tetap sepenuhnya di RPC submit_presensi (sisi server, tidak bisa dilewati).
  const handleQrScanned = useCallback(async (rawText: string) => {
    const payload = parseQrPayload(rawText)
    if (!payload) {
      setStatusCheckin('gagal')
      setPesanCheckin('QR tidak dikenali. Pastikan Anda scan QR absensi GENSITI.')
      return
    }
    if (payload.kegiatanId !== kegiatan.id) {
      setStatusCheckin('gagal')
      setPesanCheckin('QR ini bukan untuk kegiatan yang sedang Anda buka.')
      return
    }
    setLoadingAksi(true)
    setStatusCheckin('idle')
    setPesanCheckin(null)
    try {
      const { queued } = await submitCheckinDenganKode(payload.kode)
      setStatusCheckin('sukses')
      setPesanCheckin(queued
        ? 'Sinyal terputus -- absensi disimpan di perangkat & akan otomatis terkirim saat online kembali.'
        : 'Absensi berhasil dicatat. Terima kasih!')
      setSudahHadir(true)
    } catch (e) {
      setStatusCheckin('gagal')
      setPesanCheckin(e instanceof Error ? e.message : 'Gagal melakukan absensi.')
    } finally {
      setLoadingAksi(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kegiatan.id])

  // Nyalakan kamera & mulai scan -- hanya dijalankan saat Generus menekan tombol "Scan QR"
  // (tidak otomatis saat komponen mount) supaya tidak minta izin kamera tanpa alasan jelas.
  const mulaiScanner = useCallback(async () => {
    setScannerError(null)
    setScannerAktif(true)
  }, [])

  useEffect(() => {
    if (!scannerAktif || !videoRef.current) return
    let disposed = false
    const scanner = new QrScanner(
      videoRef.current,
      (result) => {
        const text = typeof result === 'string' ? result : result.data
        if (disposed) return
        disposed = true
        scanner.stop()
        setScannerAktif(false)
        handleQrScanned(text)
      },
      {
        highlightScanRegion: true,
        highlightCodeOutline: true,
        preferredCamera: 'environment',
      }
    )
    scannerRef.current = scanner
    scanner.start().catch((e) => {
      setScannerError(e instanceof Error ? e.message : 'Tidak bisa mengakses kamera. Gunakan input kode manual.')
      setScannerAktif(false)
    })
    return () => {
      disposed = true
      scanner.stop()
      scanner.destroy()
      scannerRef.current = null
    }
  }, [scannerAktif, handleQrScanned])

  const hentikanScanner = () => {
    scannerRef.current?.stop()
    setScannerAktif(false)
  }

  // Ketua/Wakil Ketua/Sekretaris tetap Generus/pengurus muda-mudi yang wajib presensi --
  // begitu mereka membuka sesi (kode aktif), tombol ini kirim kode yang SUDAH tertampil di
  // layar mereka sendiri ke submit_presensi, jadi tidak perlu scan QR sendiri.
  const checkinSendiriSebagaiPengurus = async () => {
    if (!kode) return
    setLoadingCheckinSendiri(true)
    setStatusCheckin('idle')
    setPesanCheckin(null)
    try {
      const { queued } = await submitCheckinDenganKode(kode)
      setStatusCheckin('sukses')
      setPesanCheckin(queued
        ? 'Sinyal terputus -- kehadiran disimpan di perangkat & akan otomatis terkirim saat online kembali.'
        : 'Kehadiran Anda berhasil dicatat. Terima kasih!')
      setSudahHadir(true)
    } catch (e) {
      setStatusCheckin('gagal')
      setPesanCheckin(e instanceof Error ? e.message : 'Gagal mencatat kehadiran.')
    } finally {
      setLoadingCheckinSendiri(false)
    }
  }

  if (kegiatan.status !== 'ongoing') return null

  const fmtMenitDetik = (total: number) => {
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  // Super Admin bukan Generus organisasi dan tidak lagi berwenang mengelola presensi --
  // tampilkan keterangan netral saja, jangan tampilkan tombol "Mulai Presensi" ataupun
  // form self check-in "Hadir" (dia tidak pernah tercatat sebagai peserta kegiatan apapun).
  if (isSuperAdmin) {
    return (
      <div className="mt-3 pt-3 border-t border-slate-100">
        <p className="text-xs text-slate-400 italic text-center">Absensi dikelola oleh Ketua/Wakil Ketua/Sekretaris.</p>
      </div>
    )
  }

  // PPG adalah pembina Muda-Mudi se-Daerah Bekasi Timur, BUKAN peserta kegiatan KMM/Generus
  // -- meskipun PPG punya alamat sambung & nomor identitas (format PPG-{scope}-XXX), mereka
  // sengaja dikecualikan dari absensi/presensi kegiatan (beda dari Generus/pengurus lain yang
  // wajib presensi). Ditangani sama seperti Super Admin: tidak tampil form self check-in.
  if (isPPG(user)) {
    return (
      <div className="mt-3 pt-3 border-t border-slate-100">
        <p className="text-xs text-slate-400 italic text-center">PPG tidak termasuk peserta absensi kegiatan.</p>
      </div>
    )
  }

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      {jumlahAntrean > 0 && (
        <div className="mb-2 bg-amber-50 text-amber-700 text-xs rounded-xl px-3 py-2 text-center font-medium">
          📶 {jumlahAntrean} presensi menunggu sinkronisasi -- terkirim otomatis saat online
        </div>
      )}
      {canOpenPresensi ? (
        <div className="space-y-2">
          {!isAktif ? (
            <button
              onClick={mulaiAtauRotasiPresensi}
              disabled={loadingAksi}
              className="w-full py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 disabled:bg-green-300 transition"
            >
              {loadingAksi ? 'Memulai...' : '▶ Mulai Absensi'}
            </button>
          ) : (
            <div className="bg-slate-50 rounded-xl p-4 text-center">
              {kegiatan.presensi_metode_qr && (
                <>
                  <p className="text-xs text-slate-400 mb-2">Scan QR untuk Absensi</p>
                  {qrDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qrDataUrl} alt="QR Absensi" className="mx-auto rounded-lg border border-slate-200 bg-white p-2" width={200} height={200} />
                  ) : (
                    <div className="w-[200px] h-[200px] mx-auto rounded-lg border border-slate-200 bg-white flex items-center justify-center">
                      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </>
              )}
              <p className="text-xs text-slate-400 mt-2">Berlaku {fmtMenitDetik(sisaDetik)} lagi · otomatis berganti tiap 5 menit</p>
              <p className="text-[11px] text-slate-300 mt-1 font-mono tracking-widest">Kode: {kode}</p>
              <button
                onClick={mulaiAtauRotasiPresensi}
                disabled={loadingAksi}
                className="mt-3 text-xs text-blue-600 hover:underline font-medium"
              >
                Perbarui kode sekarang
              </button>
            </div>
          )}
          {isAktif && RFID_PRESENSI_READY && kegiatan.presensi_metode_rfid && (
            <RfidKioskInput
              kegiatanId={kegiatan.id}
              kode={kode}
              onCheckin={(pesan, sukses) => {
                setStatusCheckin(sukses ? 'sukses' : 'gagal')
                setPesanCheckin(pesan)
              }}
            />
          )}
          {errorMsg && <p className="text-xs text-red-500">{errorMsg}</p>}

          {/* Pengurus yang membuka sesi ini tetap wajib presensi sebagai peserta kegiatan --
              tombol terpisah dari panel kontrol QR di atas, supaya jelas ini mencatat
              kehadiran DIRI SENDIRI, bukan aksi mengelola presensi orang lain. */}
          {isAktif && (
            sudahHadir ? (
              <div className="bg-green-50 text-green-700 text-sm rounded-xl px-3 py-2 text-center font-medium">
                ✓ Anda sudah tercatat hadir
              </div>
            ) : (
              <button
                onClick={checkinSendiriSebagaiPengurus}
                disabled={loadingCheckinSendiri}
                className="w-full py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition"
              >
                {loadingCheckinSendiri ? 'Menyimpan...' : '✓ Saya Hadir'}
              </button>
            )
          )}
          {pesanCheckin && (
            <p className={`text-xs ${statusCheckin === 'sukses' ? 'text-green-600' : 'text-red-500'}`}>{pesanCheckin}</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {sudahHadir ? (
            <div className="bg-green-50 text-green-700 text-sm rounded-xl px-3 py-2 text-center font-medium">
              ✓ Anda sudah tercatat hadir
            </div>
          ) : scannerAktif ? (
            <div className="space-y-2">
              <div className="rounded-xl overflow-hidden bg-black">
                <video ref={videoRef} className="w-full aspect-square object-cover" muted playsInline />
              </div>
              <button
                onClick={hentikanScanner}
                className="w-full py-2 bg-slate-100 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-200 transition"
              >
                Batalkan Scan
              </button>
            </div>
          ) : modeInputManual ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  value={inputKode}
                  onChange={e => setInputKode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Masukkan kode 6 digit"
                  inputMode="numeric"
                  maxLength={6}
                  className="flex-1 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm font-mono tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={submitCheckin}
                  disabled={loadingAksi || inputKode.length !== 6}
                  className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition"
                >
                  {loadingAksi ? '...' : 'Hadir'}
                </button>
              </div>
              <button
                onClick={() => setModeInputManual(false)}
                className="w-full text-xs text-blue-600 hover:underline font-medium"
              >
                ← Kembali ke scan QR
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <button
                onClick={mulaiScanner}
                className="w-full py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition"
              >
                📷 Scan QR Absensi
              </button>
              {scannerError && <p className="text-xs text-red-500">{scannerError}</p>}
              <button
                onClick={() => setModeInputManual(true)}
                className="w-full text-xs text-slate-400 hover:text-blue-600 hover:underline"
              >
                Kamera tidak bisa? Masukkan kode manual
              </button>
            </div>
          )}
          {pesanCheckin && (
            <p className={`text-xs ${statusCheckin === 'sukses' ? 'text-green-600' : 'text-red-500'}`}>{pesanCheckin}</p>
          )}
        </div>
      )}
    </div>
  )
}
