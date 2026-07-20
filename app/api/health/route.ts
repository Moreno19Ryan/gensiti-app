import { NextResponse } from 'next/server'

// Endpoint publik tanpa autentikasi -- dipakai monitoring eksternal (UptimeRobot) untuk
// cek aplikasi masih hidup. Sengaja tidak menyentuh Supabase/database sama sekali, supaya
// tetap menjawab 200 selama proses Next.js-nya hidup walau database sedang bermasalah, dan
// tidak pernah membocorkan info internal apapun di responsnya.
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ status: 'ok', timestamp: new Date().toISOString() })
}
