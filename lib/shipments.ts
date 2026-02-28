import { sql } from '@vercel/postgres'
import type { ShipmentStatus } from './logistics'

export interface ShipmentRow {
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

export interface TrackingEventRow {
  id: number
  shipment_id: number
  event_time: string
  location: string
  detail: string
}

export interface Shipment {
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

export async function getShipmentById(id: number): Promise<Shipment | null> {
  const { rows } = await sql<ShipmentRow>`
    SELECT id, carrier, carrier_code, tracking_number, shipping_date,
           route_from, route_to, status, latest_update, latest_context,
           eta, created_at, updated_at
    FROM shipments
    WHERE id = ${id}
  `

  if (rows.length === 0) {
    return null
  }

  const row = rows[0]
  const events = await fetchEventsForShipmentId(id)

  return mapRowToShipment(row, events)
}

export async function fetchEventsForShipmentId(shipmentId: number): Promise<TrackingEventRow[]> {
  const { rows } = await sql<TrackingEventRow>`
    SELECT id, shipment_id, event_time, location, detail
    FROM tracking_events
    WHERE shipment_id = ${shipmentId}
    ORDER BY id DESC
  `
  return rows
}

export async function fetchEventsForShipmentIds(shipmentIds: number[]): Promise<Map<number, TrackingEventRow[]>> {
  if (shipmentIds.length === 0) {
    return new Map()
  }

  const { rows } = await sql<TrackingEventRow>`
    SELECT id, shipment_id, event_time, location, detail
    FROM tracking_events
    WHERE shipment_id = ANY(${shipmentIds})
    ORDER BY id DESC
  `

  const eventMap = new Map<number, TrackingEventRow[]>()
  for (const event of rows) {
    const list = eventMap.get(event.shipment_id)
    if (list) {
      list.push(event)
    } else {
      eventMap.set(event.shipment_id, [event])
    }
  }

  return eventMap
}

export function mapRowToShipment(row: ShipmentRow, events: TrackingEventRow[]): Shipment {
  return {
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
    events: events.map((event) => ({
      id: event.id,
      time: event.event_time,
      location: event.location,
      detail: event.detail,
    })),
  }
}
