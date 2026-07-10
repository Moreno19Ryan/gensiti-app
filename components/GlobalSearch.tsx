'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// Kotak pencarian global di topbar -- mencari lintas 4 modul (Generus, Kegiatan, Dokumen,
// Pengumuman) lewat RPC public.global_search (migration create_global_search_rpc), yang
// melakukan scoping wilayah SENDIRI di sisi database (bukan cuma RLS) supaya konsisten dgn
// pola scoping eksplisit yang sudah dipakai di masing-masing halaman (lihat lib/roles.ts).
// Query di-debounce 350ms supaya tidak membombardir DB setiap ketukan tombol.

interface SearchResult {
  kategori: string
  judul: string
  subjudul: string
  url: string
  created_at: string
}

const KATEGORI_ICON: Record<string, string> = {
  Generus: '👤',
  Kegiatan: '📅',
  Dokumen: '📄',
  Pengumuman: '📢',
}

export default function GlobalSearch() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce: batalkan pencarian sebelumnya setiap kali query berubah, jalankan RPC 350ms
  // setelah user berhenti mengetik. Query < 2 karakter tidak dikirim ke server sama sekali
  // (selain boros, RPC juga langsung return kosong utk kasus ini).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (query.trim().length < 2) {
      setResults([])
      setLoading(false)
      setError('')
      return
    }

    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      const { data, error: err } = await supabase.rpc('global_search', { p_query: query.trim() })
      if (err) {
        setError('Gagal memuat hasil pencarian.')
        setResults([])
      } else {
        setError('')
        setResults((data as SearchResult[]) || [])
      }
      setLoading(false)
    }, 350)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  // Tutup panel hasil kalau klik di luar kotak search
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (result: SearchResult) => {
    setOpen(false)
    setQuery('')
    setResults([])
    router.push(result.url)
  }

  const showPanel = open && query.trim().length >= 2

  return (
    <div ref={containerRef} className="relative w-full max-w-xs hidden sm:block">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">🔍</span>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Cari Generus, kegiatan, dokumen..."
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-slate-800 transition"
        />
      </div>

      {showPanel && (
        <div className="absolute top-full left-0 mt-2 w-full min-w-[320px] bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-100 dark:border-slate-700 max-h-96 overflow-y-auto z-50">
          {loading ? (
            <div className="p-4 flex items-center justify-center text-slate-400 text-sm gap-2">
              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              Mencari...
            </div>
          ) : error ? (
            <div className="p-4 text-sm text-red-600">{error}</div>
          ) : results.length === 0 ? (
            <div className="p-4 text-sm text-slate-400 text-center">Tidak ada hasil untuk &quot;{query}&quot;.</div>
          ) : (
            <ul className="py-1">
              {results.map((r, i) => (
                <li key={`${r.kategori}-${i}`}>
                  <button
                    onClick={() => handleSelect(r)}
                    className="w-full text-left px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 transition flex items-start gap-3"
                  >
                    <span className="text-base leading-none mt-0.5">{KATEGORI_ICON[r.kategori] || '📁'}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{r.judul}</span>
                      <span className="block text-xs text-slate-400 truncate">
                        {r.kategori}{r.subjudul ? ` · ${r.subjudul}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
