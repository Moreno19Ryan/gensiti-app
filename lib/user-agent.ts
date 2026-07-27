// Label perangkat manusiawi dari User-Agent -- dipakai di app/(dashboard)/profil/perangkat
// (self-service "Perangkat Aktif") dan tab Sesi Aktif di Monitoring & Log. HEURISTIK
// SEDERHANA, bukan library parsing UA lengkap -- User-Agent bisa dipalsukan/tidak lengkap,
// jadi ini murni utk kemudahan pengenalan visual ("oh ini HP saya"), BUKAN dasar keputusan
// keamanan apapun (otorisasi tetap sepenuhnya dari sesi/RLS, tidak pernah dari string ini).
export function labelPerangkat(userAgent: string | null): string {
  if (!userAgent) return 'Perangkat tidak diketahui'

  const os = /Android/.test(userAgent) ? 'Android'
    : /iPhone|iPad|iPod/.test(userAgent) ? 'iOS'
    : /Windows/.test(userAgent) ? 'Windows'
    : /Mac OS X/.test(userAgent) ? 'macOS'
    : /Linux/.test(userAgent) ? 'Linux'
    : null

  const browser = /Edg\//.test(userAgent) ? 'Edge'
    : /OPR\/|Opera/.test(userAgent) ? 'Opera'
    : /Chrome\//.test(userAgent) ? 'Chrome'
    : /Firefox\//.test(userAgent) ? 'Firefox'
    : /Safari\// .test(userAgent) && !/Chrome/.test(userAgent) ? 'Safari'
    : 'Browser'

  return os ? `${browser} di ${os}` : browser
}
