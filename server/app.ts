import cors from 'cors'
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { createKuaidi100Client, type LogisticsClient, type ShipmentStatus } from './logistics.ts'

interface ShipmentRow {
  id: number
  carrier: string
  carrier_code: string
  tracking_number: string
  shipping_date: string
  route_from: string
  route_to: string
  status: ShipmentStatus
  latest_update: string
  latest_context: string
  eta: string
  created_at: string
  updated_at: string
}

interface TrackingEventRow {
  id: number
  shipment_id: number
  event_time: string
  location: string
  detail: string
}

interface Shipment {
  id: number
  trackingNumber: string
  shippingDate: string
  carrierName: string
  carrierCode: string
  status: ShipmentStatus
  latestUpdate: string
  latestContext: string
  routeFrom: string
  routeTo: string
  eta: string
  createdAt: string
  updatedAt: string
  events: Array<{
    id: number
    time: string
    location: string
    detail: string
  }>
}

interface CreateShipmentBody {
  trackingNumber?: string
}

interface AppOptions {
  dbPathForHealth?: string
  logisticsClient?: LogisticsClient
}

const STATUS_SET = new Set<ShipmentStatus>(['已下单', '揽收中', '运输中', '派送中', '已签收', '异常'])

class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function parseIntOrDefault(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) {
    return fallback
  }
  const value = Number(raw)
  if (!Number.isInteger(value)) {
    return fallback
  }
  return Math.min(max, Math.max(min, value))
}

function readQueryString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function nowLabel(): string {
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

function todayDate(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function isTrackingNumberConflict(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed: shipments\.tracking_number/.test(error.message)
}

function runInTransaction<T>(db: DatabaseSync, callback: () => T): T {
  db.exec('BEGIN IMMEDIATE;')
  try {
    const result = callback()
    db.exec('COMMIT;')
    return result
  } catch (error) {
    try {
      db.exec('ROLLBACK;')
    } catch {
      // Ignore rollback failures.
    }
    throw error
  }
}

function mapRowsToShipments(rows: ShipmentRow[], events: TrackingEventRow[]): Shipment[] {
  const eventMap = new Map<number, TrackingEventRow[]>()

  for (const event of events) {
    const list = eventMap.get(event.shipment_id)
    if (list) {
      list.push(event)
    } else {
      eventMap.set(event.shipment_id, [event])
    }
  }

  return rows.map((row) => ({
    id: row.id,
    trackingNumber: row.tracking_number,
    shippingDate: row.shipping_date,
    carrierName: row.carrier,
    carrierCode: row.carrier_code,
    status: row.status,
    latestUpdate: row.latest_update,
    latestContext: row.latest_context,
    routeFrom: row.route_from,
    routeTo: row.route_to,
    eta: row.eta,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    events: (eventMap.get(row.id) ?? []).map((event) => ({
      id: event.id,
      time: event.event_time,
      location: event.location,
      detail: event.detail,
    })),
  }))
}

function fetchEventsForShipmentIds(db: DatabaseSync, shipmentIds: number[]): TrackingEventRow[] {
  if (shipmentIds.length === 0) {
    return []
  }

  const placeholders = shipmentIds.map(() => '?').join(', ')
  return db
    .prepare(
      `
        SELECT id, shipment_id, event_time, location, detail
        FROM tracking_events
        WHERE shipment_id IN (${placeholders})
        ORDER BY id DESC
      `,
    )
    .all(...shipmentIds) as unknown as TrackingEventRow[]
}

function getShipmentById(db: DatabaseSync, id: number): Shipment | null {
  const row = db
    .prepare(
      `
        SELECT id, carrier, carrier_code, tracking_number, shipping_date,
               route_from, route_to, status, latest_update, latest_context,
               eta, created_at, updated_at
        FROM shipments
        WHERE id = ?
      `,
    )
    .get(id) as ShipmentRow | undefined

  if (!row) {
    return null
  }

  const events = fetchEventsForShipmentIds(db, [id])
  return mapRowsToShipments([row], events)[0]
}

function listShipments(db: DatabaseSync, query: Request['query']) {
  const requestedPage = parseIntOrDefault(readQueryString(query.page), 1, 1, 1_000_000)
  const pageSize = parseIntOrDefault(readQueryString(query.pageSize), 12, 1, 50)
  const statusRaw = readQueryString(query.status)
  const keyword = readQueryString(query.q)

  if (statusRaw && !STATUS_SET.has(statusRaw as ShipmentStatus)) {
    throw new ApiError(400, '状态筛选无效。')
  }

  const conditions: string[] = []
  const params: string[] = []

  if (statusRaw) {
    conditions.push('status = ?')
    params.push(statusRaw)
  }

  if (keyword) {
    const like = `%${keyword}%`
    conditions.push('(tracking_number LIKE ? OR carrier LIKE ? OR latest_context LIKE ? OR route_from LIKE ? OR route_to LIKE ?)')
    params.push(like, like, like, like, like)
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const countRow = db
    .prepare(`SELECT COUNT(*) AS total FROM shipments ${whereSql}`)
    .get(...params) as unknown as { total: number }

  const total = Number(countRow.total ?? 0)
  const totalPages = total === 0 ? 1 : Math.ceil(total / pageSize)
  const page = Math.min(requestedPage, totalPages)
  const offset = (page - 1) * pageSize

  const rows = db
    .prepare(
      `
        SELECT id, carrier, carrier_code, tracking_number, shipping_date,
               route_from, route_to, status, latest_update, latest_context,
               eta, created_at, updated_at
        FROM shipments
        ${whereSql}
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
      `,
    )
    .all(...params, pageSize, offset) as unknown as ShipmentRow[]

  const events = fetchEventsForShipmentIds(
    db,
    rows.map((row) => row.id),
  )

  const summaryRow = db
    .prepare(
      `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status IN ('揽收中', '运输中', '派送中') THEN 1 ELSE 0 END) AS in_transit,
          SUM(CASE WHEN status = '已签收' THEN 1 ELSE 0 END) AS delivered,
          SUM(CASE WHEN status = '异常' THEN 1 ELSE 0 END) AS exception
        FROM shipments
      `,
    )
    .get() as unknown as {
    total: number | null
    in_transit: number | null
    delivered: number | null
    exception: number | null
  }

  return {
    shipments: mapRowsToShipments(rows, events),
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
    },
    summary: {
      total: Number(summaryRow.total ?? 0),
      inTransit: Number(summaryRow.in_transit ?? 0),
      delivered: Number(summaryRow.delivered ?? 0),
      exception: Number(summaryRow.exception ?? 0),
    },
  }
}

export function createApp(db: DatabaseSync, options: AppOptions = {}) {
  const logisticsClient = options.logisticsClient ?? createKuaidi100Client()
  const app = express()

  app.use(cors())
  app.use(express.json())

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, database: options.dbPathForHealth ?? 'unknown' })
  })

  app.get('/api/shipments', (req, res) => {
    const payload = listShipments(db, req.query)
    res.json(payload)
  })

  app.post('/api/shipments', async (req, res) => {
    const body = req.body as CreateShipmentBody
    const trackingNumber = body.trackingNumber?.trim() ?? ''

    if (trackingNumber.length < 6) {
      throw new ApiError(400, '请填写有效的快递单号。')
    }

    const snapshot = await logisticsClient.query(trackingNumber).catch(() => {
      throw new ApiError(422, '未查询到物流，请确认单号后重试。')
    })

    let shipmentId = 0
    const shippingDate = todayDate()

    try {
      runInTransaction(db, () => {
        const now = nowLabel()
        const latestUpdate = snapshot.latestUpdate === '-' ? now : snapshot.latestUpdate
        const result = db
          .prepare(
            `
              INSERT INTO shipments (
                platform, carrier, carrier_code, tracking_number, shipping_date,
                recipient, phone, route_from, route_to, status, latest_update,
                latest_context, eta, items, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .run(
            'API自动查询',
            snapshot.carrierName,
            snapshot.carrierCode,
            trackingNumber,
            shippingDate,
            '未知',
            '未知',
            snapshot.routeFrom,
            snapshot.routeTo,
            snapshot.status,
            latestUpdate,
            snapshot.latestContext,
            snapshot.eta,
            'API自动识别',
            now,
            now,
          )

        shipmentId = Number(result.lastInsertRowid)

        const events = snapshot.events.length > 0 ? snapshot.events : [{ time: latestUpdate, location: '物流系统', detail: snapshot.latestContext }]
        const statement = db.prepare(
          `
            INSERT INTO tracking_events (shipment_id, event_time, location, detail)
            VALUES (?, ?, ?, ?)
          `,
        )

        for (const event of events) {
          statement.run(shipmentId, event.time || now, event.location || '物流节点', event.detail || '暂无信息')
        }
      })
    } catch (error) {
      if (isTrackingNumberConflict(error)) {
        throw new ApiError(409, '该运单号已存在。')
      }
      throw error
    }

    const shipment = getShipmentById(db, shipmentId)
    res.status(201).json({ shipment })
  })

  app.patch('/api/shipments/:id/sync', async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError(400, '无效的运单 ID。')
    }

    const current = db
      .prepare('SELECT id, tracking_number FROM shipments WHERE id = ?')
      .get(id) as { id: number; tracking_number: string } | undefined

    if (!current) {
      throw new ApiError(404, '运单不存在。')
    }

    const snapshot = await logisticsClient.query(current.tracking_number).catch(() => {
      throw new ApiError(422, '同步失败，暂未获取到最新物流。')
    })

    const shipment = runInTransaction(db, () => {
      const now = nowLabel()
      const latestUpdate = snapshot.latestUpdate === '-' ? now : snapshot.latestUpdate

      db.prepare(
        `
          UPDATE shipments
          SET carrier = ?, carrier_code = ?, route_from = ?, route_to = ?,
              status = ?, latest_update = ?, latest_context = ?, eta = ?, updated_at = ?
          WHERE id = ?
        `,
      ).run(
        snapshot.carrierName,
        snapshot.carrierCode,
        snapshot.routeFrom,
        snapshot.routeTo,
        snapshot.status,
        latestUpdate,
        snapshot.latestContext,
        snapshot.eta,
        now,
        id,
      )

      db.prepare('DELETE FROM tracking_events WHERE shipment_id = ?').run(id)

      const events = snapshot.events.length > 0 ? snapshot.events : [{ time: latestUpdate, location: '物流系统', detail: snapshot.latestContext }]
      const statement = db.prepare(
        `
          INSERT INTO tracking_events (shipment_id, event_time, location, detail)
          VALUES (?, ?, ?, ?)
        `,
      )

      for (const event of events) {
        statement.run(id, event.time || now, event.location || '物流节点', event.detail || '暂无信息')
      }

      const updated = getShipmentById(db, id)
      if (!updated) {
        throw new ApiError(404, '运单不存在。')
      }
      return updated
    })

    res.json({ shipment })
  })

  app.use((_req, res) => {
    res.status(404).json({ message: '接口不存在。' })
  })

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    void next
    if (error instanceof ApiError) {
      res.status(error.status).json({ message: error.message })
      return
    }

    console.error(error)
    res.status(500).json({ message: '服务器内部错误，请稍后重试。' })
  })

  return app
}
