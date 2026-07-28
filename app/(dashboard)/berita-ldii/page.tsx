'use client'

import { useEffect, useState } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { useFeatureAccess } from '@/lib/feature-toggles'
import { BeritaLdii } from '@/lib/types'
import { SkeletonCards } from '@/components/Skeleton'

// Menu "Berita LDII" -- mirror ringkasan RSS feed publik ldii.or.id (organisasi induk),
// diperbarui otomatis tiap 4 jam lewat pg_cron -> Edge Function fetch-berita-ldii (lihat
// migrasi berita_ldii_rss_mirror & ARCHITECTURE.md). HANYA cuplikan + link ke sumber asli
// yang pernah disimpan -- tombol "Baca Selengkapnya" selalu buka tab baru ke ldii.or.id,
// TIDAK PERNAH menampilkan isi artikel lengkap di dalam GENSITI (soal hak cipta).
export default function BeritaLdiiPage() {
  const { user } = useUser()
  const { enabled: featureEnabled, checking: featureChecking } = useFeatureAccess(user, 'berita-ldii')
  const [data, setData] = useState<BeritaLdii[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    supabase
      .from('berita_ldii')
      .select('id, judul, ringkasan, link, tanggal_publish, kategori')
      .order('tanggal_publish', { ascending: false })
      .limit(50)
      .then(({ data: rows, error }) => {
        if (error) console.error('Gagal memuat berita LDII:', error.message)
        setData(rows || [])
        setLoading(false)
      })
  }, [user])

  if (!featureChecking && !featureEnabled) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
        <div className="text-4xl mb-3">🚫</div>
        <p className="font-semibold text-slate-600">Fitur Dinonaktifkan</p>
        <p className="text-sm mt-1">Menu Berita LDII saat ini dinonaktifkan oleh Super Admin untuk jenjang Anda.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-bold text-slate-800">Berita LDII</h2>
        <p className="text-slate-400 text-sm">Ringkasan berita dari ldii.or.id -- diperbarui otomatis tiap beberapa jam</p>
      </div>

      {loading ? (
        <SkeletonCards />
      ) : data.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
          <div className="text-4xl mb-2">📰</div>
          <p>Belum ada berita nih</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {data.map(b => (
            <div key={b.id} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition">
              {b.kategori.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                  {b.kategori.slice(0, 4).map(k => (
                    <span key={k} className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                      {k}
                    </span>
                  ))}
                </div>
              )}
              <h3 className="font-semibold text-slate-800">{b.judul}</h3>
              {b.ringkasan && <p className="text-slate-500 text-sm mt-1 line-clamp-3">{b.ringkasan}</p>}
              <div className="flex items-center justify-between mt-3">
                <span className="text-xs text-slate-400">
                  {b.tanggal_publish
                    ? new Date(b.tanggal_publish).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
                    : ''}
                </span>
                <a href={b.link} target="_blank" rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline text-sm font-medium">
                  Baca Selengkapnya di ldii.or.id →
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
