'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Kegiatan } from '@/lib/types'
import { UserProfile } from '@/lib/types'
import { isGenerusBiasa } from '@/lib/roles'
import Modal from '@/components/Modal'

interface Props {
  kegiatan: Kegiatan
  user: UserProfile | null
}

type StatusLokal = { status: 'menunggu' | 'disetujui' | 'ditolak'; alasan: string; catatan_pengurus: string | null } | null

// Panel pengajuan izin tidak hadir untuk Generus biasa -- muncul di kartu kegiatan baik
// yang masih 'upcoming' (izin sebelum kegiatan) maupun 'ongoing' (izin dadakan saat kegiatan
// berlangsung), TIDAK untuk kegiatan 'selesai' (sudah lewat, tidak ada gunanya izin lagi).
// Pengurus (Ketua/Wapon/Sekretaris), PPG, dan Super Admin tidak melihat panel ini -- mereka
// wajib presensi lewat PresensiPanel (kalau pengurus) atau tidak termasuk peserta sama sekali
// (PPG/Super Admin).
export default function PengajuanIzinPanel({ kegiatan, user }: Props) {
  const tampilkan = isGenerusBiasa(user) && kegiatan.status !== 'selesai'

  const [statusLokal, setStatusLokal] = useState<StatusLokal>(null)
  const [sudahHadir, setSudahHadir] = useState(false)
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [alasan, setAlasan] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const cekStatus = useCallback(async () => {
    if (!user || !tampilkan) return
    setLoading(true)
    try {
      const { data: generus } = await supabase.from('generus').select('id').eq('user_id', user.id).maybeSingle()
      if (!generus) return

      const [{ data: absen }, { data: pengajuan }] = await Promise.all([
        supabase.from('absensi').select('status').eq('kegiatan_id', kegiatan.id).eq('generus_id', generus.id).maybeSingle(),
        supabase
          .from('pengajuan_izin_presensi')
          .select('status, alasan, catatan_pengurus')
          .eq('kegiatan_id', kegiatan.id)
          .eq('generus_id', generus.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])

      setSudahHadir(absen?.status === 'hadir')
      setStatusLokal(pengajuan || null)
    } finally {
      setLoading(false)
    }
  }, [user, kegiatan.id, tampilkan])

  useEffect(() => {
    cekStatus()
  }, [cekStatus])

  const handleAjukan = async () => {
    if (!alasan.trim()) {
      setErrorMsg('Alasan wajib diisi.')
      return
    }
    setSubmitting(true)
    setErrorMsg(null)
    try {
      const { error } = await supabase.rpc('ajukan_izin_presensi', {
        p_kegiatan_id: kegiatan.id,
        p_alasan: alasan.trim(),
      })
      if (error) throw error
      setModalOpen(false)
      setAlasan('')
      await cekStatus()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Gagal mengajukan izin.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!tampilkan || loading || sudahHadir) return null

  // Sudah pernah mengajukan -- tampilkan status apa adanya, jangan tampilkan tombol ajukan
  // lagi kalau masih menunggu (mencegah spam pengajuan berulang, RPC juga sudah menolak ini).
  if (statusLokal) {
    const badge = {
      menunggu: { label: '⏳ Izin Anda sedang menunggu persetujuan pengurus', color: 'bg-amber-50 text-amber-700 border-amber-100' },
      disetujui: { label: '✓ Izin Anda disetujui pengurus', color: 'bg-green-50 text-green-700 border-green-100' },
      ditolak: { label: '✕ Izin Anda ditolak pengurus', color: 'bg-red-50 text-red-600 border-red-100' },
    }[statusLokal.status]

    return (
      <div className="mt-3 pt-3 border-t border-slate-100">
        <div className={`text-xs rounded-xl px-3 py-2 border ${badge.color}`}>
          <p className="font-medium">{badge.label}</p>
          <p className="mt-0.5 text-[11px] opacity-80">Alasan: {statusLokal.alasan}</p>
          {statusLokal.catatan_pengurus && (
            <p className="mt-0.5 text-[11px] opacity-80">Catatan pengurus: {statusLokal.catatan_pengurus}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="mt-3 pt-3 border-t border-slate-100">
        <button
          onClick={() => { setModalOpen(true); setErrorMsg(null) }}
          className="w-full py-2 border border-amber-200 bg-amber-50 text-amber-700 rounded-xl text-sm font-medium hover:bg-amber-100 transition"
        >
          📋 Ajukan Izin Tidak Hadir
        </button>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Ajukan Izin Tidak Hadir">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Alasan *</label>
            <textarea
              value={alasan}
              onChange={e => setAlasan(e.target.value)}
              rows={3}
              placeholder="Contoh: Sakit demam, ada acara keluarga, dll."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <p className="text-xs text-slate-400">Pengajuan izin akan ditinjau oleh Ketua/Wakil Ketua/Sekretaris sebelum resmi tercatat.</p>
          {errorMsg && (
            <div className="p-2.5 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600">{errorMsg}</div>
          )}
          <div className="flex gap-3 pt-2 border-t border-slate-100">
            <button onClick={() => setModalOpen(false)} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">
              Batal
            </button>
            <button
              onClick={handleAjukan}
              disabled={submitting}
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition"
            >
              {submitting ? 'Mengajukan...' : 'Ajukan Izin'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
