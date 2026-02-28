import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import type { DatabaseSync } from 'node:sqlite'
import supertest from 'supertest'
import { createApp } from './app.ts'
import { createDatabase } from './database.ts'
import type { LogisticsClient, LogisticsSnapshot } from './logistics.ts'

let db: DatabaseSync
let request: ReturnType<typeof supertest>
let tempDir = ''

function createMockLogisticsClient(): LogisticsClient {
  const callCount = new Map<string, number>()

  const base = (status: LogisticsSnapshot['status'], count: number): LogisticsSnapshot => ({
    carrierCode: 'shunfeng',
    carrierName: '顺丰速运',
    status,
    latestUpdate: `2026-02-28 09:0${count}:00`,
    latestContext: status === '派送中' ? '快递员已出发派送' : '快件正在中转途中',
    routeFrom: '杭州转运中心',
    routeTo: status === '派送中' ? '上海闵行站点' : '上海转运中心',
    eta: status === '派送中' ? '派送中，请注意查收' : '以物流更新为准',
    events: [
      {
        time: `2026-02-28 09:0${count}:00`,
        location: status === '派送中' ? '上海闵行站点' : '上海转运中心',
        detail: status === '派送中' ? '快递员已出发派送' : '快件正在中转途中',
      },
    ],
  })

  return {
    async query(trackingNumber: string): Promise<LogisticsSnapshot> {
      const count = (callCount.get(trackingNumber) ?? 0) + 1
      callCount.set(trackingNumber, count)
      return count >= 2 ? base('派送中', count) : base('运输中', count)
    },
  }
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'shipment-hub-'))
  const dbPath = join(tempDir, 'test.db')
  db = createDatabase(dbPath)
  request = supertest(
    createApp(db, {
      dbPathForHealth: dbPath,
      logisticsClient: createMockLogisticsClient(),
    }),
  )
})

afterEach(() => {
  db.close()
  rmSync(tempDir, { recursive: true, force: true })
})

const basePayload = {
  trackingNumber: 'SF1234567890123',
}

test('GET /api/shipments returns empty list by default', async () => {
  const response = await request.get('/api/shipments').expect(200)

  assert.deepEqual(response.body.shipments, [])
  assert.equal(response.body.pagination.total, 0)
  assert.equal(response.body.pagination.page, 1)
  assert.equal(response.body.summary.total, 0)
})

test('POST /api/shipments creates shipment by tracking number only', async () => {
  const createRes = await request.post('/api/shipments').send(basePayload).expect(201)

  assert.equal(createRes.body.shipment.trackingNumber, basePayload.trackingNumber)
  assert.equal(createRes.body.shipment.events.length, 1)
  assert.equal(createRes.body.shipment.status, '运输中')
})

test('POST /api/shipments rejects duplicate tracking number with 409', async () => {
  await request.post('/api/shipments').send(basePayload).expect(201)

  const duplicateRes = await request.post('/api/shipments').send(basePayload).expect(409)
  assert.equal(duplicateRes.body.message, '该运单号已存在。')
})

test('PATCH /api/shipments/:id/sync refreshes logistics snapshot', async () => {
  const createRes = await request.post('/api/shipments').send(basePayload).expect(201)
  const id = Number(createRes.body.shipment.id)

  const syncRes = await request.patch(`/api/shipments/${id}/sync`).expect(200)

  assert.equal(syncRes.body.shipment.status, '派送中')
  assert.equal(syncRes.body.shipment.latestContext, '快递员已出发派送')
})

test('GET /api/shipments supports pagination and status filter', async () => {
  await request.post('/api/shipments').send({ trackingNumber: 'SF1111111111111' }).expect(201)
  await request.post('/api/shipments').send({ trackingNumber: 'SF2222222222222' }).expect(201)
  await request.post('/api/shipments').send({ trackingNumber: 'SF3333333333333' }).expect(201)

  const pageRes = await request.get('/api/shipments?page=1&pageSize=2').expect(200)
  assert.equal(pageRes.body.shipments.length, 2)
  assert.equal(pageRes.body.pagination.total, 3)
  assert.equal(pageRes.body.pagination.totalPages, 2)

  const filteredRes = await request.get('/api/shipments?status=运输中').expect(200)
  assert.equal(filteredRes.body.shipments.length, 3)

  const searchRes = await request.get('/api/shipments?q=SF3333333333333').expect(200)
  assert.equal(searchRes.body.shipments.length, 1)
})

