import { NextRequest, NextResponse } from 'next/server'
import { getNotifications, markNotificationRead, markAllNotificationsRead } from '@/lib/store'
import { ApiError, apiErrorResponse, requireActor } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const actor = requireActor(req)
    const notifications = await getNotifications(actor)
    const unread = notifications.filter((n) => !n.read).length
    return NextResponse.json({ notifications, unread }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return apiErrorResponse(error) }
}

export async function POST(req: NextRequest) {
  try {
    const actor = requireActor(req)
    const body: unknown = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['id', 'all'].includes(key))) throw new ApiError(400, 'Supply a notification ID or mark all notifications read.')
    const { id, all } = body as { id?: unknown; all?: unknown }
    if (all === true && id === undefined) await markAllNotificationsRead(actor)
    else if (typeof id === 'string' && id.length > 0 && id.length <= 128 && all === undefined) await markNotificationRead(id, actor)
    else throw new ApiError(400, 'Supply a notification ID or mark all notifications read.')
    return NextResponse.json({ ok: true })
  } catch (error) { return apiErrorResponse(error) }
}
