'use client'

import { useEffect, useState, type MouseEvent } from 'react'
import Link from 'next/link'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { useFeatureAccess } from '@/lib/feature-toggles'
import { BeritaDisimpan, SumberBeritaOrganisasi } from '@/lib/types'
import { SkeletonCards } from '@/components/Skeleton'
import { toast } from '@/lib/toast'

const WhatsappIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413" />
  </svg>
)

const BookmarkIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
    <path d="M6 3.75A1.75 1.75 0 0 1 7.75 2h8.5A1.75 1.75 0 0 1 18 3.75V21l-6-3.5L6 21V3.75Z" />
  </svg>
)

const SUMBER_LABEL: Record<SumberBeritaOrganisasi, string> = {
  'ldii-bekasi': 'LDII Kota Bekasi',
  ldii: 'LDII',
  asad: 'PERSINAS ASAD',
  senkom: 'SENKOM Mitra Polri',
}

// Halaman "Berita Tersimpan" -- daftar artikel yang di-bookmark user dari halaman Berita
// Organisasi (app/(dashboard)/berita/page.tsx), lintas 4 sumber sekaligus (tidak pakai tab
// karena daftar tersimpan biasanya pendek). Data berasal dari snapshot metadata di
// berita_disimpan (bukan join balik ke berita_organisasi) -- lihat ARCHITECTURE.md §12.
export default function BeritaTersimpanPage() {
  const { user } = useUser()
  const { enabled: featureEnabled, checking: featureChecking } = useFeatureAccess(user, 'berita-organisasi')
  const [data, setData] = useState<BeritaDisimpan[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = () => {
    if (!user) return
    setLoading(true)
    supabase
      .from('berita_disimpan')
      .select('id, link, judul, sumber, tanggal_publish, gambar_url, created_at')
      .order('created_at', { ascending: false })
      .then(({ data: rows, error }) => {
        if (error) console.error('Gagal memuat berita tersimpan:', error.message)
        setData(rows || [])
        setLoading(false)
      })
  }

  // Data-fetching on mount/dependency-change (bukan derived state) -- pola sama seperti
  // halaman lain di app ini.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const bagikanWhatsapp = (e: MouseEvent<HTMLButtonElement>, judul: string, link: string) => {
    e.preventDefault()
    e.stopPropagation()
    const teks = `${judul}\n${link}`
    window.open(`https://wa.me/?text=${encodeURIComponent(teks)}`, '_blank', 'noopener,noreferrer')
  }

  const hapusBookmark = async (e: MouseEvent<HTMLButtonElement>, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    const { error } = await supabase.from('berita_disimpan').delete().eq('id', id)
    if (error) { toast.gagal('Gagal menghapus bookmark: ' + error.message); return }
    setData(prev => prev.filter(b => b.id !== id))
  }

  const fmtTanggal = (tanggal: string | null) =>
    tanggal ? new Date(tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : ''

  if (!featureChecking && !featureEnabled) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
        <div className="text-4xl mb-3">🚫</div>
        <p className="font-semibold text-slate-600">Fitur Dinonaktifkan</p>
        <p className="text-sm mt-1">Menu Berita Organisasi saat ini dinonaktifkan oleh Super Admin untuk jenjang Anda.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-lg shrink-0">🔖</div>
        <div className="flex-1">
          <h2 className="font-bold text-slate-800 dark:text-slate-100">Berita Tersimpan</h2>
          <p className="text-slate-400 text-xs">Artikel yang sudah kamu simpan dari Berita Organisasi</p>
        </div>
        <Link
          href="/berita"
          className="shrink-0 px-3 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        >
          ← Kembali
        </Link>
      </div>

      {loading ? (
        <SkeletonCards />
      ) : data.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-12 text-center text-slate-400">
          <div className="text-4xl mb-2">🔖</div>
          <p>Belum ada berita yang disimpan</p>
          <Link href="/berita" className="mt-3 inline-block text-blue-600 dark:text-blue-400 text-sm font-semibold hover:underline">
            Jelajahi Berita Organisasi →
          </Link>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {data.map(b => (
            <div
              key={b.id}
              className="group relative flex gap-3 bg-white dark:bg-slate-800 rounded-2xl p-3 shadow-sm border border-slate-100 dark:border-slate-700 hover:shadow-md hover:border-blue-200 dark:hover:border-blue-800 transition"
            >
              <a
                href={b.link}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={b.judul}
                className="absolute inset-0 z-0 rounded-2xl"
              />
              <div className="relative z-[1] w-24 h-24 sm:w-28 sm:h-28 rounded-xl overflow-hidden shrink-0 bg-gradient-to-br from-indigo-100 to-blue-100 dark:from-indigo-900/40 dark:to-blue-900/40 pointer-events-none">
                {b.gambar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.gambar_url} alt="" className="w-full h-full object-cover"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-2xl opacity-30">📰</div>
                )}
              </div>
              <div className="relative z-[1] min-w-0 flex-1 flex flex-col pointer-events-none">
                <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-500 dark:text-indigo-400 mb-0.5">{SUMBER_LABEL[b.sumber]}</span>
                <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-sm leading-snug line-clamp-2">{b.judul}</h3>
                <div className="mt-auto pt-1 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-400">{fmtTanggal(b.tanggal_publish)}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={e => hapusBookmark(e, b.id)}
                      aria-label="Hapus dari tersimpan"
                      title="Hapus dari tersimpan"
                      className="pointer-events-auto w-5 h-5 flex items-center justify-center rounded-full bg-amber-100 text-amber-600 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50 transition-colors"
                    >
                      <BookmarkIcon className="w-3 h-3" />
                    </button>
                    <button
                      onClick={e => bagikanWhatsapp(e, b.judul, b.link)}
                      aria-label="Bagikan ke WhatsApp"
                      title="Bagikan ke WhatsApp"
                      className="pointer-events-auto w-5 h-5 flex items-center justify-center rounded-full bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50 transition-colors"
                    >
                      <WhatsappIcon className="w-3 h-3" />
                    </button>
                    <span className="text-blue-600 dark:text-blue-400 text-[11px] font-semibold">Baca →</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
