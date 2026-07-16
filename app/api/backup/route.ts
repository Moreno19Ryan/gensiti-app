import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// Endpoint backup khusus Super Admin -- dipindahkan dari query client-side langsung
// (app/(dashboard)/backup-data/page.tsx sebelumnya memakai `supabase.from(table).select('*')`
// lewat client biasa, tunduk RLS). Masalahnya: kalau RLS SELECT untuk salah satu dari 10 tabel
// yang MEMANG diizinkan berubah/diperketat di masa depan (mis. audit peran berikutnya), backup
// bisa diam-diam menghasilkan data yang terpotong tanpa `error` -- Super Admin tidak akan sadar
// sampai butuh restore. Endpoint ini pakai service role (bypass RLS) supaya hasil backup selalu
// mencerminkan isi tabel yang sebenarnya, BUKAN untuk memperluas wewenang Super Admin.
//
// PENTING: EXCLUDED_TABLES di bawah harus SELALU sinkron dengan daftar yang sama persis di
// app/(dashboard)/backup-data/page.tsx (keuangan, catatan_pembinaan, email_preferensi) -- itu
// adalah keputusan desain permanen (Super Admin tidak memiliki akses data keuangan/komunikasi
// tertutup PPG/preferensi pribadi pengguna), BUKAN sekadar batasan RLS yang boleh dilewati di
// sini. Service role di endpoint ini sengaja TIDAK PERNAH query tabel-tabel tsb sama sekali.

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const BACKUP_TABLES = [
  'desa', 'kelompok', 'roles', 'users', 'generus',
  'kegiatan', 'absensi', 'pengumuman', 'dokumen', 'notifikasi',
] as const

async function getCallerIsSuperAdmin(req: NextRequest, supabaseAdmin: ReturnType<typeof adminClient>): Promise<boolean> {
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return false

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token)
  if (userErr || !userData.user) return false

  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('is_active, roles:role_id(tingkatan)')
    .eq('id', userData.user.id)
    .single()

  // Fail-closed: apapun selain is_active TEPAT true dianggap TIDAK aktif.
  if (!profile || profile.is_active !== true) return false
  const role = profile.roles as { tingkatan?: string } | { tingkatan?: string }[] | null
  const roleObj = Array.isArray(role) ? role[0] : role
  return roleObj?.tingkatan === 'super_admin'
}

export async function POST(req: NextRequest) {
  const supabaseAdmin = adminClient()

  const isSuperAdmin = await getCallerIsSuperAdmin(req, supabaseAdmin)
  if (!isSuperAdmin) {
    return NextResponse.json({ error: 'Hanya Super Admin yang dapat menjalankan backup.' }, { status: 403 })
  }

  const result: Record<string, unknown[]> = {}
  const tableStatus: Record<string, { count: number; error?: string }> = {}
  let hadError = false

  for (const table of BACKUP_TABLES) {
    const { data, error } = await supabaseAdmin.from(table).select('*')
    if (error) {
      hadError = true
      tableStatus[table] = { count: 0, error: error.message }
      result[table] = []
      continue
    }
    result[table] = data || []
    tableStatus[table] = { count: data?.length || 0 }
  }

  return NextResponse.json({ data: result, tableStatus, hadError })
}
