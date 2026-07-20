// Indikator loading bermerek GENSITI -- logo yang berputar (1.5 detik/putaran, linear,
// lihat @keyframes spin-logo di app/globals.css), pengganti ring spinner generik
// (border-t-transparent + animate-spin) yang sebelumnya dipakai berulang di halaman-halaman
// full-page loading. Konsisten dengan `<img src="/icons/icon-512.png">` yang sudah dipakai
// untuk logo GENSITI di app/login/page.tsx & app/lupa-password/page.tsx.

const SIZE_CLASSES = {
  sm: 'w-6 h-6',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
} as const

type LoadingSpinnerProps = {
  /** Teks di samping logo, mis. "Memuat...". Dikosongkan kalau tidak perlu label. */
  label?: string
  /** Ukuran logo. Default 'md' (w-8 h-8), sama seperti spinner full-page yang sudah ada. */
  size?: keyof typeof SIZE_CLASSES
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
  const spinner = (
    <div className={`flex items-center gap-3 ${className}`}>
      <img
        src="/icons/icon-512.png"
        alt="Memuat"
        className={`${SIZE_CLASSES[size]} animate-spin-slow shrink-0`}
      />
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
