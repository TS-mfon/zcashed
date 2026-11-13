import { NextRequest, NextResponse } from 'next/server'
import { getNotifications, markNotificationRead, markAllNotificationsRead } from '@/lib/store'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const address = searchParams.get('address')
  if (!address) return NextResponse.json({ notifications: [], unread: 0 })
  const notifications = await getNotifications(address)
  const unread = notifications.filter((n) => !n.read).length
  return NextResponse.json({ notifications, unread })
}

export async function POST(req: NextRequest) {
  try {
    const { id, address, all } = await req.json()
    if (all && address) {
      await markAllNotificationsRead(address)
    } else if (id) {
      await markNotificationRead(id)
    }
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
