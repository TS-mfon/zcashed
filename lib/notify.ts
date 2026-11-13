import { addNotification } from './store'
import { NotificationType } from './types'
import { generateId } from './utils'

export async function notify(params: {
  to: string
  type: NotificationType
  title: string
  body?: string
  link?: string
}) {
  await addNotification({
    id: generateId(),
    recipientAddress: params.to,
    type: params.type,
    title: params.title,
    body: params.body ?? '',
    link: params.link ?? '',
    read: false,
    createdAt: new Date().toISOString(),
  })
}
