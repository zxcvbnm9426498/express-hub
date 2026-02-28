import { sql } from '@vercel/postgres'

// 创建表结构
export async function initDatabase() {
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

  // 创建索引
  await sql`CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status)`
  await sql`CREATE INDEX IF NOT EXISTS idx_shipments_carrier ON shipments(carrier)`
  await sql`CREATE INDEX IF NOT EXISTS idx_shipments_created_at ON shipments(created_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS idx_tracking_events_shipment ON tracking_events(shipment_id, id DESC)`
}

// 获取当前时间字符串
export function nowLabel(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    ' ',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
    ':',
    pad(date.getSeconds()),
  ].join('')
}

// 获取今天日期
export function todayDate(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
