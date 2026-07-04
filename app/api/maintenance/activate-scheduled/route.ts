import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// Endpoint untuk mengeksekusi JADWAL Mode Perawatan yang sudah ditentukan Super Admin
// sebelumnya (lihat app/(dashboard)/monitoring/page.tsx, tombol "Jadwalkan Perawatan").
// Dipanggil oleh polling client MANAPUN yang sedang login (bukan hanya Super Admin) --
// lihat app/(dashboard)/layout.tsx & app/maintenance/page.tsx -- karena tidak ada cron job
// di proyek ini untuk mendeteksi waktu terjadwal terlewati secara mandiri.
//
// SENGAJA pakai service role (bukan client biasa yang tunduk RLS system_config_update_superadmin)
// karena tindakan ini BUKAN memberi wewenang baru ke pemanggil -- yang dieksekusi murni jadwal
// yang SUDAH ditentukan Super Admin sebelumnya lewat kolom scheduled_activation_at. Endpoint ini
// tidak menerima input apapun dari klien (tidak ada body), jadi tidak ada permukaan untuk
// disalahgunakan mengubah maintenance_message secara sewenang-wenang -- pesan diambil dari
// scheduled_message yang sudah tersimpan di database.
//
// Idempotent by design: memakai kondisi WHERE scheduled_activation_at <= now() AND
// maintenance_mode = false, jadi aman dipanggil bersamaan oleh banyak client yang sedang
// polling -- panggilan kedua dst tidak akan mengubah apapun (baris sudah tidak match kondisi).

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(req: NextRequest) {
  const supabaseAdmin = adminClient()

  // Verifikasi pemanggil adalah user yang benar-benar login (bukan anonim) -- tidak perlu
  // Super Admin, siapapun yang authenticated boleh "membantu" memicu eksekusi jadwal yang
  // sudah ditentukan, sama seperti mereka juga yang akan terkena dampaknya.
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) {
    return NextResponse.json({ error: 'Tidak terautentikasi.' }, { status: 401 })
  }
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token)
  if (userErr || !userData.user) {
    return NextResponse.json({ error: 'Tidak terautentikasi.' }, { status: 401 })
  }

  const { data: config } = await supabaseAdmin
    .from('system_config')
    .select('scheduled_activation_at, scheduled_message, maintenance_mode')
    .eq('id', true)
    .maybeSingle()

  if (!config?.scheduled_activation_at || config.maintenance_mode) {
    // Tidak ada jadwal pending, atau sudah aktif duluan (dipicu client lain) -- tidak ada
    // yang perlu dilakukan.
    return NextResponse.json({ activated: false })
  }

  if (new Date(config.scheduled_activation_at) > new Date()) {
    return NextResponse.json({ activated: false })
  }

  const { error } = await supabaseAdmin
    .from('system_config')
    .update({
      maintenance_mode: true,
      maintenance_message: config.scheduled_message,
      maintenance_started_at: new Date().toISOString(),
      scheduled_activation_at: null,
      scheduled_message: null,
    })
    .eq('id', true)
    .eq('maintenance_mode', false) // guard idempotency tambahan di level query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ activated: true })
}
