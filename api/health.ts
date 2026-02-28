import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sql } from '@vercel/postgres'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  try {
    // 测试数据库连接
    const result = await sql`SELECT 1 as test`

    // 尝试创建表
    await sql`
      CREATE TABLE IF NOT EXISTS shipments (
        id SERIAL PRIMARY KEY,
        platform TEXT NOT NULL DEFAULT 'API自动查询',
        carrier TEXT NOT NULL,
        carrier_code TEXT NOT NULL DEFAULT '',
        tracking_number TEXT NOT NULL UNIQUE,
        shipping_date TEXT NOT NULL DEFAULT '',
        recipient TEXT NOT NULL DEFAULT '未知',
        phone TEXT NOT NULL DEFAULT '未知',
        route_from TEXT NOT NULL,
        route_to TEXT NOT NULL,
        status TEXT NOT NULL,
        latest_update TEXT NOT NULL,
        latest_context TEXT NOT NULL DEFAULT '',
        eta TEXT NOT NULL,
        items TEXT NOT NULL DEFAULT 'API自动识别',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT ''
      )
    `

    await sql`
      CREATE TABLE IF NOT EXISTS tracking_events (
        id SERIAL PRIMARY KEY,
        shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
        event_time TEXT NOT NULL,
        location TEXT NOT NULL,
        detail TEXT NOT NULL
      )
    `

    return res.json({
      ok: true,
      database: 'postgresql',
      connectionTest: result.rows[0]
    })
  } catch (error) {
    console.error('Health check error:', error)
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      hasPostgresUrl: !!process.env.POSTGRES_URL
    })
  }
}
