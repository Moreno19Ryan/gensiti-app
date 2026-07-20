// Indikator loading gaya Google/Material (circular progress indicator): cincin SVG yang
// berputar (1.5 detik/putaran, linear -- lihat --animate-spin-slow di app/globals.css)
// sekaligus arc-nya memanjang/memendek dan warnanya bersiklus lewat palet brand GENSITI
// (biru utama + aksen teal/amber/navy dari logo). Pengganti ring spinner generik polos
// (border-t-transparent + animate-spin) yang sebelumnya dipakai berulang di halaman-halaman
// full-page loading. Percobaan awal memutar logo GENSITI utuh (icon-512.png) dibatalkan --
// logo itu ilustratif (ada menara & figur orang, bukan lambang simetris) sehingga kalau
// diputar 360 derajat malah kelihatan aneh; sekarang cukup ambil paletnya, bukan gambarnya.

const SIZE_PX = {
  sm: 24,
  md: 32,
  lg: 48,
} as const

type LoadingSpinnerProps = {
  /** Teks di samping spinner, mis. "Memuat...". Dikosongkan kalau tidak perlu label. */
  label?: string
  /** Ukuran cincin. Default 'md' (32px), sama seperti spinner full-page yang sudah ada. */
  size?: keyof typeof SIZE_PX
  /** true untuk loading gate satu halaman penuh (mis. saat cek sesi/auth sebelum render). */
  fullScreen?: boolean
  className?: string
}

export default function LoadingSpinner({
  label,
  size = 'md',
  fullScreen = false,
  className = '',
}: LoadingSpinnerProps) {
  const px = SIZE_PX[size]

  const spinner = (
    <div className={`flex items-center gap-3 ${className}`}>
      <svg
        className="animate-spin-slow shrink-0"
        width={px}
        height={px}
        viewBox="0 0 50 50"
        role="status"
        aria-label={label || 'Memuat'}
      >
        <circle
          className="gensiti-spinner-arc"
          cx="25"
          cy="25"
          r="20"
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
        />
      </svg>
      {label && (
        <span className="text-slate-500 dark:text-slate-300 font-medium">{label}</span>
      )}
    </div>
  )

  if (!fullScreen) return spinner

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      {spinner}
    </div>
  )
}
