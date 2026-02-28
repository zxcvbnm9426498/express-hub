import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sql } from '@vercel/postgres'
import { initDatabase, nowLabel, todayDate } from '../lib/database.js'
import { queryLogistics } from '../lib/logistics.js'
import { getShipmentById, fetchEventsForShipmentIds, mapRowToShipment, type ShipmentRow, type ShipmentStatus } from '../lib/shipments.js'

const STATUS_SET = new Set<ShipmentStatus>(['已下单', '揽收中', '运输中', '派送中', '已签收', '异常'])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  try {
    await initDatabase()

    if (req.method === 'GET') {
      return await handleList(req, res)
    }

    if (req.method === 'POST') {
      return await handleCreate(req, res)
    }

    return res.status(405).json({ message: 'Method not allowed' })
  } catch (error) {
    console.error('API Error:', error)
    return res.status(500).json({ message: '服务器内部错误: ' + String(error) })
  }
}

async function handleList(req: VercelRequest, res: VercelResponse) {
  const page = Math.max(1, parseInt(String(req.query.page)) || 1)
  const pageSize = Math.min(50, Math.max(1, parseInt(String(req.query.pageSize)) || 12))
  const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : ''
  const keyword = typeof req.query.q === 'string' ? req.query.q.trim() : ''

  // 构建查询
  let countQuery: string
  let dataQuery: string
  let params: (string | number)[] = []

  if (statusFilter && keyword) {
    const like = `%${keyword}%`
    countQuery = `SELECT COUNT(*) AS total FROM shipments WHERE status = $1 AND (tracking_number ILIKE $2 OR carrier ILIKE $2 OR latest_context ILIKE $2)`
    dataQuery = `SELECT id, carrier, carrier_code, tracking_number, shipping_date, route_from, route_to, status, latest_update, latest_context, eta, created_at, updated_at FROM shipments WHERE status = $1 AND (tracking_number ILIKE $2 OR carrier ILIKE $2 OR latest_context ILIKE $2) ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`
    params = [statusFilter, like, pageSize, (page - 1) * pageSize]
  } else if (statusFilter) {
    countQuery = `SELECT COUNT(*) AS total FROM shipments WHERE status = $1`
    dataQuery = `SELECT id, carrier, carrier_code, tracking_number, shipping_date, route_from, route_to, status, latest_update, latest_context, eta, created_at, updated_at FROM shipments WHERE status = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`
    params = [statusFilter, pageSize, (page - 1) * pageSize]
  } else if (keyword) {
    const like = `%${keyword}%`
    countQuery = `SELECT COUNT(*) AS total FROM shipments WHERE tracking_number ILIKE $1 OR carrier ILIKE $1 OR latest_context ILIKE $1`
    dataQuery = `SELECT id, carrier, carrier_code, tracking_number, shipping_date, route_from, route_to, status, latest_update, latest_context, eta, created_at, updated_at FROM shipments WHERE tracking_number ILIKE $1 OR carrier ILIKE $1 OR latest_context ILIKE $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`
    params = [like, pageSize, (page - 1) * pageSize]
  } else {
    countQuery = `SELECT COUNT(*) AS total FROM shipments`
    dataQuery = `SELECT id, carrier, carrier_code, tracking_number, shipping_date, route_from, route_to, status, latest_update, latest_context, eta, created_at, updated_at FROM shipments ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`
    params = [pageSize, (page - 1) * pageSize]
  }

  // 执行查询
  const countResult = await sql.query(countQuery, statusFilter && keyword ? [statusFilter, `%${keyword}%`] : statusFilter ? [statusFilter] : keyword ? [`%${keyword}%`] : [])
  const total = Number(countResult.rows[0]?.total || 0)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(page, totalPages)

  const dataResult = await sql.query(dataQuery, params) as { rows: ShipmentRow[] }

  // 查询事件
  const shipmentIds = dataResult.rows.map((r) => r.id)
  const eventMap = await fetchEventsForShipmentIds(shipmentIds)
  const shipments = dataResult.rows.map((row) => mapRowToShipment(row, eventMap.get(row.id) || []))

  // 统计汇总
  const summaryResult = await sql`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status IN ('揽收中', '运输中', '派送中') THEN 1 ELSE 0 END) AS in_transit,
      SUM(CASE WHEN status = '已签收' THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN status = '异常' THEN 1 ELSE 0 END) AS exception
    FROM shipments
  `

  const summary = {
    total: Number(summaryResult.rows[0]?.total || 0),
    inTransit: Number(summaryResult.rows[0]?.in_transit || 0),
    delivered: Number(summaryResult.rows[0]?.delivered || 0),
    exception: Number(summaryResult.rows[0]?.exception || 0),
  }

  return res.json({
    shipments,
    pagination: { page: currentPage, pageSize, total, totalPages },
    summary,
  })
}

async function handleCreate(req: VercelRequest, res: VercelResponse) {
  const { trackingNumber } = req.body || {}
  const trackingNumberTrimmed = String(trackingNumber || '').trim()

  if (trackingNumberTrimmed.length < 6) {
    return res.status(400).json({ message: '请填写有效的快递单号。' })
  }

  const snapshot = await queryLogistics(trackingNumberTrimmed, {
    key: process.env.KD100_KEY,
    customer: process.env.KD100_CUSTOMER,
    phone: process.env.KD100_PHONE,
    shipFrom: process.env.KD100_FROM,
    shipTo: process.env.KD100_TO,
  }).catch(() => {
    throw { status: 422, message: '未查询到物流，请确认单号后重试。' }
  })

  const now = nowLabel()
  const shippingDate = todayDate()
  const latestUpdate = snapshot.latestUpdate === '-' ? now : snapshot.latestUpdate

  let shipmentId: number
  try {
    const insertResult = await sql`
      INSERT INTO shipments (
        carrier, carrier_code, tracking_number, shipping_date,
        route_from, route_to, status, latest_update,
        latest_context, eta, created_at, updated_at
      ) VALUES (
        ${snapshot.carrierName}, ${snapshot.carrierCode}, ${trackingNumberTrimmed}, ${shippingDate},
        ${snapshot.routeFrom}, ${snapshot.routeTo}, ${snapshot.status}, ${latestUpdate},
        ${snapshot.latestContext}, ${snapshot.eta}, ${now}, ${now}
      )
      RETURNING id
    `
    shipmentId = insertResult.rows[0].id as number
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({ message: '该运单号已存在。' })
    }
    throw error
  }

  const events = snapshot.events.length > 0 ? snapshot.events : [{ time: latestUpdate, location: '物流系统', detail: snapshot.latestContext }]
  for (const event of events) {
    await sql`
      INSERT INTO tracking_events (shipment_id, event_time, location, detail)
      VALUES (${shipmentId}, ${event.time || now}, ${event.location || '物流节点'}, ${event.detail || '暂无信息'})
    `
  }

  const shipment = await getShipmentById(shipmentId)
  return res.status(201).json({ shipment })
}
