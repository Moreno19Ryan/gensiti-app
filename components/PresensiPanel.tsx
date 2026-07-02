'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Kegiatan } from '@/lib/types'
import { canManagePresensi } from '@/lib/roles'
import { UserProfile } from '@/lib/types'

interface Props {
  kegiatan: Kegiatan
  user: UserProfile | null
  onUpdated?: (kegiatan: Kegiatan) => void
}

const KODE_MASA_BERLAKU_MS = 5 * 60 * 1000

// Panel presensi untuk kartu kegiatan yang sedang berlangsung (status = 'ongoing').
// - Ketua/Wakil Ketua, Sekretaris, & Super Admin: bisa "Mulai Presensi" -> menampilkan kode
//   besar yang otomatis diperbarui (rotasi) setiap 5 menit sampai ditutup manual.
// - Ru'yah biasa & pengurus lain (Bendahara, Kemandirian, dll): melihat form input kode
//   6 digit untuk self check-in, sama seperti ru'yah biasa.
export default function PresensiPanel({ kegiatan, user, onUpdated }: Props) {
  const canOpenPresensi = canManagePresensi(user)
  const [kode, setKode] = useState<string | null>(kegiatan.kode_presensi_aktif)
  const [expiredAt, setExpiredAt] = useState<string | null>(kegiatan.kode_presensi_expired_at)
  const [sisaDetik, setSisaDetik] = useState<number>(0)
  const [loadingAksi, setLoadingAksi] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [inputKode, setInputKode] = useState('')
  const [statusCheckin, setStatusCheckin] = useState<'idle' | 'sukses' | 'gagal'>('idle')
  const [pesanCheckin, setPesanCheckin] = useState<string | null>(null)
  const [sudahHadir, setSudahHadir] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isAktif = !!kode && !!expiredAt && new Date(expiredAt).getTime() > Date.now()

  // Cek apakah ru'yah/pengurus yang login sudah tercatat hadir untuk kegiatan ini
  const cekStatusKehadiran = useCallback(async () => {
    if (!user) return
    const { data: anggota } = await supabase.from('anggota').select('id').eq('user_id', user.id).maybeSingle()
    if (!anggota) return
    const { data: absen } = await supabase
      .from('absensi')
      .select('status')
      .eq('kegiatan_id', kegiatan.id)
      .eq('anggota_id', anggota.id)
      .maybeSingle()
    setSudahHadir(absen?.status === 'hadir')
  }, [user, kegiatan.id])

  useEffect(() => {
    cekStatusKehadiran()
  }, [cekStatusKehadiran])

  // Hitung mundur tampilan detik
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (!expiredAt) {
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
      setErrorMsg(e instanceof Error ? e.message : 'Gagal membuka presensi.')
    } finally {
      setLoadingAksi(false)
    }
  }, [kegiatan, onUpdated])

  // Auto-rotasi kode setiap 5 menit selama pengurus sudah membuka sesi presensi ini,
  // supaya layar/HP yang dibiarkan terbuka otomatis menampilkan kode terbaru.
  useEffect(() => {
    if (!canOpenPresensi || !isAktif) return
    const rotasi = setInterval(() => {
      mulaiAtauRotasiPresensi()
    }, KODE_MASA_BERLAKU_MS)
    return () => clearInterval(rotasi)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canOpenPresensi, isAktif])

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
      const { error } = await supabase.rpc('submit_presensi', {
        p_kegiatan_id: kegiatan.id,
        p_kode: inputKode.trim(),
      })
      if (error) throw error
      setStatusCheckin('sukses')
      setPesanCheckin('Presensi berhasil dicatat. Terima kasih!')
      setSudahHadir(true)
      setInputKode('')
    } catch (e) {
      setStatusCheckin('gagal')
      setPesanCheckin(e instanceof Error ? e.message : 'Gagal melakukan presensi.')
    } finally {
      setLoadingAksi(false)
    }
  }

  if (kegiatan.status !== 'ongoing') return null

  const fmtMenitDetik = (total: number) => {
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      {canOpenPresensi ? (
        <div className="space-y-2">
          {!isAktif ? (
            <button
              onClick={mulaiAtauRotasiPresensi}
              disabled={loadingAksi}
              className="w-full py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 disabled:bg-green-300 transition"
            >
              {loadingAksi ? 'Memulai...' : '▶ Mulai Presensi'}
            </button>
          ) : (
            <div className="bg-slate-50 rounded-xl p-4 text-center">
              <p className="text-xs text-slate-400 mb-1">Kode Presensi</p>
              <p className="text-4xl font-mono font-bold tracking-widest text-blue-700">{kode}</p>
              <p className="text-xs text-slate-400 mt-2">Berlaku {fmtMenitDetik(sisaDetik)} lagi · otomatis berganti tiap 5 menit</p>
              <button
                onClick={mulaiAtauRotasiPresensi}
                disabled={loadingAksi}
                className="mt-3 text-xs text-blue-600 hover:underline font-medium"
              >
                Perbarui kode sekarang
              </button>
            </div>
          )}
          {errorMsg && <p className="text-xs text-red-500">{errorMsg}</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {sudahHadir ? (
            <div className="bg-green-50 text-green-700 text-sm rounded-xl px-3 py-2 text-center font-medium">
              ✓ Anda sudah tercatat hadir
            </div>
          ) : (
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
          )}
          {pesanCheckin && (
            <p className={`text-xs ${statusCheckin === 'sukses' ? 'text-green-600' : 'text-red-500'}`}>{pesanCheckin}</p>
          )}
        </div>
      )}
    </div>
  )
}
