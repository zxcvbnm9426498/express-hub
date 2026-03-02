import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sql } from '@vercel/postgres'
import { initDatabase } from '../../lib/database.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'DELETE') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const id = parseInt(String(req.query.id))

  if (!id || isNaN(id)) {
    return res.status(400).json({ message: '无效的快递ID' })
  }

  try {
    await initDatabase()

    // 先删除关联的物流事件
    await sql`DELETE FROM tracking_events WHERE shipment_id = ${id}`

    // 再删除快递记录
    const result = await sql`DELETE FROM shipments WHERE id = ${id} RETURNING id`

    if (result.rowCount === 0) {
      return res.status(404).json({ message: '快递记录不存在' })
    }

    return res.json({ success: true, message: '删除成功' })
  } catch (error) {
    console.error('Delete Error:', error)
    return res.status(500).json({ message: '删除失败: ' + String(error) })
  }
}
