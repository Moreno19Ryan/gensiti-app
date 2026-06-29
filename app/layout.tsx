import type { Metadata } from 'next'
import './globals.css'
import { UserProvider } from '@/lib/user-context'

export const metadata: Metadata = {
  title: 'RYZA - Smart Organization Management',
  description: 'Sistem Manajemen Organisasi Cerdas',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className="h-full">
      <body className="min-h-full">
        <UserProvider>
          {children}
        </UserProvider>
      </body>
    </html>
  )
}
