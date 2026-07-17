import type { Metadata, Viewport } from 'next'
import './globals.css'
import { UserProvider } from '@/lib/user-context'
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister'

export const metadata: Metadata = {
  title: 'GENSITI - Smart Organization Management',
  description: 'Sistem Manajemen Organisasi Cerdas',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'GENSITI',
  },
  icons: {
    icon: '/icons/favicon-32.png',
    apple: '/icons/apple-touch-icon.png',
  },
}

// theme-color dipisah ke Viewport export (bukan Metadata) sesuai konvensi Next.js 14+ --
// Next akan warning/gagal build kalau theme-color masih ditaruh di Metadata.
export const viewport: Viewport = {
  themeColor: '#0381FE',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className="h-full">
      <body className="min-h-full">
        <ServiceWorkerRegister />
        <UserProvider>
          {children}
        </UserProvider>
      </body>
    </html>
  )
}
