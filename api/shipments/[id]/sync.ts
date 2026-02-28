import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sql } from '@vercel/postgres'
import { initDatabase, nowLabel } from '../lib/database'
import { queryLogistics } from '../lib/logistics'
import { getShipmentById } from '../lib/shipments'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'PATCH') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    await initDatabase()

    const id = parseInt(String(req.query.id))
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: '无效的运单 ID。' })
    }

    // 查询当前运单
    const { rows } = await sql`SELECT id, tracking_number FROM shipments WHERE id = ${id}`
    if (rows.length === 0) {
      return res.status(404).json({ message: '运单不存在。' })
    }

    const trackingNumber = rows[0].tracking_number

    // 同步物流
    const snapshot = await queryLogistics(trackingNumber, {
      key: process.env.KD100_KEY,
      customer: process.env.KD100_CUSTOMER,
      phone: process.env.KD100_PHONE,
      shipFrom: process.env.KD100_FROM,
      shipTo: process.env.KD100_TO,
    }).catch(() => {
      throw { status: 422, message: '同步失败，暂未获取到最新物流。' }
    })

    const now = nowLabel()
    const latestUpdate = snapshot.latestUpdate === '-' ? now : snapshot.latestUpdate

    // 更新运单
    await sql`
      UPDATE shipments
      SET carrier = ${snapshot.carrierName}, carrier_code = ${snapshot.carrierCode},
          route_from = ${snapshot.routeFrom}, route_to = ${snapshot.routeTo},
          status = ${snapshot.status}, latest_update = ${latestUpdate},
          latest_context = ${snapshot.latestContext}, eta = ${snapshot.eta},
          updated_at = ${now}
      WHERE id = ${id}
    `

    // 删除旧事件
    await sql`DELETE FROM tracking_events WHERE shipment_id = ${id}`

    // 插入新事件
    const events = snapshot.events.length > 0 ? snapshot.events : [{ time: latestUpdate, location: '物流系统', detail: snapshot.latestContext }]
    for (const event of events) {
      await sql`
        INSERT INTO tracking_events (shipment_id, event_time, location, detail)
        VALUES (${id}, ${event.time || now}, ${event.location || '物流节点'}, ${event.detail || '暂无信息'})
      `
    }

    const shipment = await getShipmentById(id)
    return res.json({ shipment })
  } catch (error: any) {
    console.error('Sync Error:', error)
    if (error.status && error.message) {
      return res.status(error.status).json({ message: error.message })
    }
    return res.status(500).json({ message: '服务器内部错误' })
  }
}
