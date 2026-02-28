import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type ShipmentStatus = '已下单' | '揽收中' | '运输中' | '派送中' | '已签收' | '异常'

interface TrackingEvent {
  id: number
  time: string
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
  events: TrackingEvent[]
}

interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface SummaryStats {
  total: number
  inTransit: number
  delivered: number
  exception: number
}

interface ShipmentsResponse {
  shipments: Shipment[]
  pagination: Pagination
  summary: SummaryStats
}

interface ShipmentResponse {
  shipment: Shipment | null
}

const API_BASE = import.meta.env.VITE_API_BASE_URL?.trim() ?? ''
const PAGE_SIZE = 12
const QUICK_STATUS: Array<'全部' | ShipmentStatus> = ['全部', '运输中', '派送中', '已签收', '异常']

function buildApiUrl(path: string): string {
  return API_BASE ? `${API_BASE}${path}` : path
}

function getStatusClass(status: ShipmentStatus): string {
  const map: Record<ShipmentStatus, string> = {
    已下单: 'ordered',
    揽收中: 'pickup',
    运输中: 'transit',
    派送中: 'delivery',
    已签收: 'done',
    异常: 'error',
  }
  return map[status]
}

function getStatusIcon(status: ShipmentStatus): string {
  const map: Record<ShipmentStatus, string> = {
    已下单: '📦',
    揽收中: '📥',
    运输中: '🚚',
    派送中: '📍',
    已签收: '✅',
    异常: '⚠️',
  }
  return map[status]
}

async function parseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as { message?: string }
  if (!response.ok) {
    throw new Error(payload.message ?? `请求失败（HTTP ${response.status}）`)
  }
  return payload as T
}

function App() {
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [stats, setStats] = useState<SummaryStats>({ total: 0, inTransit: 0, delivered: 0, exception: 0 })
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1 })

  const [searchInput, setSearchInput] = useState('')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<'全部' | ShipmentStatus>('全部')
  const [page, setPage] = useState(1)

  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [trackingNumber, setTrackingNumber] = useState('')
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [syncingId, setSyncingId] = useState<number | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [showAddPanel, setShowAddPanel] = useState(false)
  const [copiedId, setCopiedId] = useState<number | null>(null)

  // 弹窗状态
  const [detailShipment, setDetailShipment] = useState<Shipment | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchKeyword(searchInput.trim())
      setPage(1)
    }, 300)

    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    const controller = new AbortController()

    async function loadShipments() {
      setListError('')
      setLoading(true)

      try {
        const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
        if (searchKeyword) {
          query.set('q', searchKeyword)
        }
        if (statusFilter !== '全部') {
          query.set('status', statusFilter)
        }

        const response = await fetch(buildApiUrl(`/api/shipments?${query.toString()}`), { signal: controller.signal })
        const data = await parseJson<ShipmentsResponse>(response)

        setShipments(data.shipments)
        setStats(data.summary)
        setPagination(data.pagination)
        if (data.pagination.page !== page) {
          setPage(data.pagination.page)
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }
        const message = error instanceof Error ? error.message : '加载运单失败'
        setListError(message)
        setShipments([])
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    void loadShipments()

    return () => {
      controller.abort()
    }
  }, [page, reloadToken, searchKeyword, statusFilter])

  function resetFilters() {
    setSearchInput('')
    setSearchKeyword('')
    setStatusFilter('全部')
    setPage(1)
  }

  function manualRefresh() {
    setReloadToken((value) => value + 1)
  }

  async function copyTrackingNumber(value: string, id: number) {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedId(id)
      window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1200)
    } catch {
      setListError('复制失败，请手动复制单号。')
    }
  }

  async function submitNewShipment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')

    if (!trackingNumber.trim()) {
      setFormError('请填写快递单号。')
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch(buildApiUrl('/api/shipments'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingNumber: trackingNumber.trim() }),
      })
      await parseJson<ShipmentResponse>(response)

      setTrackingNumber('')
      setShowAddPanel(false)
      if (page === 1) {
        setReloadToken((value) => value + 1)
      } else {
        setPage(1)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '提交失败，请稍后重试。'
      setFormError(message)
    } finally {
      setSubmitting(false)
    }
  }

  async function syncShipment(id: number) {
    setListError('')
    setSyncingId(id)
    try {
      const response = await fetch(buildApiUrl(`/api/shipments/${id}/sync`), {
        method: 'PATCH',
      })
      const data = await parseJson<ShipmentResponse>(response)
      // 如果弹窗打开，同步更新弹窗内容
      if (detailShipment?.id === id && data.shipment) {
        setDetailShipment(data.shipment)
      }
      setReloadToken((value) => value + 1)
    } catch (error) {
      const message = error instanceof Error ? error.message : '同步失败'
      setListError(message)
    } finally {
      setSyncingId(null)
    }
  }

  function openDetail(shipment: Shipment) {
    setDetailShipment(shipment)
  }

  function closeDetail() {
    setDetailShipment(null)
  }

  return (
    <div className="dashboard">
      <div className={`mobile-backdrop ${showAddPanel ? 'show' : ''}`} onClick={() => setShowAddPanel(false)} />
      <div className={`mobile-backdrop ${detailShipment ? 'show' : ''}`} onClick={closeDetail} />

      <header className="topbar">
        <div className="brand-block">
          <p className="brand-tag">Express Hub</p>
          <h1>快递聚合工作台</h1>
          <p>输入单号，系统自动查询物流信息</p>
        </div>
        <div className="top-actions">
          <button type="button" className="ghost-btn" onClick={manualRefresh} disabled={loading}>
            刷新
          </button>
          <button type="button" className="primary-btn mobile-trigger" onClick={() => setShowAddPanel(true)}>
            + 添加快递
          </button>
        </div>
      </header>

      <section className="stats-band">
        <article className="stat-tile">
          <p>总运单</p>
          <h2>{stats.total}</h2>
        </article>
        <article className="stat-tile">
          <p>运输中</p>
          <h2>{stats.inTransit}</h2>
        </article>
        <article className="stat-tile">
          <p>已签收</p>
          <h2>{stats.delivered}</h2>
        </article>
        <article className="stat-tile">
          <p>异常件</p>
          <h2>{stats.exception}</h2>
        </article>
      </section>

      <section className="query-card">
        <div className="search-row">
          <label className="search-input">
            <span>关键词搜索</span>
            <input
              type="text"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="运单号 / 承运商 / 物流内容"
            />
          </label>
          <button type="button" className="ghost-btn" onClick={resetFilters}>
            清空
          </button>
        </div>

        <div className="chip-row">
          {QUICK_STATUS.map((status) => (
            <button
              key={status}
              type="button"
              className={`filter-chip ${statusFilter === status ? 'active' : ''}`}
              onClick={() => {
                setStatusFilter(status)
                setPage(1)
              }}
            >
              {status}
            </button>
          ))}
        </div>

        <div className="filter-row single">
          <p className="query-meta">
            共 {pagination.total} 条，当前第 {pagination.page}/{pagination.totalPages} 页
          </p>
        </div>
      </section>

      <main className="layout">
        <section className="list-panel full-width">
          <div className="panel-headline">
            <h2>快递列表</h2>
            <p>点击卡片查看详情</p>
          </div>

          {listError && <p className="request-error">{listError}</p>}

          <div className="shipment-grid">
            {loading && (
              <div className="empty-state">
                <h3>正在加载运单...</h3>
              </div>
            )}

            {!loading && shipments.length === 0 && (
              <div className="empty-state">
                <h3>当前没有快递记录</h3>
                <p>点击"添加快递"，输入单号即可自动查询物流。</p>
              </div>
            )}

            {!loading &&
              shipments.map((item) => (
                <article
                  key={item.id}
                  className={`shipment-tag ${getStatusClass(item.status)}`}
                  onClick={() => openDetail(item)}
                >
                  <div className="tag-header">
                    <span className="tag-icon">{getStatusIcon(item.status)}</span>
                    <span className={`tag-status ${getStatusClass(item.status)}`}>{item.status}</span>
                  </div>
                  <div className="tag-body">
                    <h3 className="tag-number">{item.trackingNumber}</h3>
                    <p className="tag-carrier">{item.carrierName}</p>
                  </div>
                  <div className="tag-footer">
                    <p className="tag-latest">{item.latestContext}</p>
                    <span className="tag-time">{item.latestUpdate}</span>
                  </div>
                  <div className="tag-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="tag-btn"
                      onClick={() => void copyTrackingNumber(item.trackingNumber, item.id)}
                    >
                      {copiedId === item.id ? '已复制' : '复制'}
                    </button>
                    <button
                      type="button"
                      className="tag-btn primary"
                      onClick={() => void syncShipment(item.id)}
                      disabled={syncingId === item.id}
                    >
                      {syncingId === item.id ? '同步中' : '同步'}
                    </button>
                  </div>
                </article>
              ))}
          </div>

          <div className="pagination-bar">
            <button type="button" className="ghost-btn" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={loading || page <= 1}>
              上一页
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => setPage((value) => Math.min(pagination.totalPages, value + 1))}
              disabled={loading || page >= pagination.totalPages}
            >
              下一页
            </button>
          </div>
        </section>

        <aside className={`compose-panel ${showAddPanel ? 'open' : ''}`}>
          <div className="compose-head">
            <div>
              <h2>添加快递</h2>
              <p>仅需单号，系统自动查询物流</p>
            </div>
            <button type="button" className="ghost-btn close-compose" onClick={() => setShowAddPanel(false)}>
              关闭
            </button>
          </div>

          <form className="add-form" onSubmit={submitNewShipment}>
            <label>
              <span>快递单号</span>
              <input
                type="text"
                value={trackingNumber}
                onChange={(event) => setTrackingNumber(event.target.value)}
                placeholder="例如 SF1234567890123"
              />
            </label>

            {formError && <p className="form-error">{formError}</p>}

            <button type="submit" className="submit-btn" disabled={submitting}>
              {submitting ? '查询并添加中...' : '查询并添加'}
            </button>
          </form>
        </aside>
      </main>

      {/* 详情弹窗 */}
      {detailShipment && (
        <div className="detail-modal" onClick={closeDetail}>
          <div className="detail-content" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header">
              <div>
                <h2>{detailShipment.trackingNumber}</h2>
                <p>{detailShipment.carrierName}</p>
              </div>
              <button type="button" className="ghost-btn" onClick={closeDetail}>
                关闭
              </button>
            </div>

            <div className="detail-status">
              <span className={`status-chip large ${getStatusClass(detailShipment.status)}`}>
                {getStatusIcon(detailShipment.status)} {detailShipment.status}
              </span>
            </div>

            <div className="detail-meta">
              <div className="meta-item">
                <strong>最新时间</strong>
                <span>{detailShipment.latestUpdate || '-'}</span>
              </div>
              <div className="meta-item">
                <strong>物流节点</strong>
                <span>{detailShipment.routeFrom} → {detailShipment.routeTo}</span>
              </div>
              <div className="meta-item full">
                <strong>最新动态</strong>
                <span>{detailShipment.latestContext || '-'}</span>
              </div>
              <div className="meta-item">
                <strong>预计送达</strong>
                <span>{detailShipment.eta || '-'}</span>
              </div>
              <div className="meta-item">
                <strong>更新时间</strong>
                <span>{detailShipment.updatedAt || detailShipment.createdAt}</span>
              </div>
            </div>

            <div className="progress-track">
              {['已下单', '揽收中', '运输中', '派送中', '已签收'].map((step, index) => {
                const progressIndex = ['已下单', '揽收中', '运输中', '派送中', '已签收'].indexOf(detailShipment.status)
                const done = progressIndex > index
                const active = progressIndex === index
                return (
                  <div key={step} className={`step ${done ? 'done' : ''} ${active ? 'active' : ''}`}>
                    <span className="dot" />
                    <span>{step}</span>
                  </div>
                )
              })}
            </div>

            <div className="detail-actions">
              <button
                type="button"
                className="primary-btn"
                onClick={() => void syncShipment(detailShipment.id)}
                disabled={syncingId === detailShipment.id}
              >
                {syncingId === detailShipment.id ? '同步中...' : '同步物流'}
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => void copyTrackingNumber(detailShipment.trackingNumber, detailShipment.id)}
              >
                {copiedId === detailShipment.id ? '已复制' : '复制单号'}
              </button>
            </div>

            <div className="detail-timeline">
              <h3>物流轨迹</h3>
              {detailShipment.events.length === 0 ? (
                <p className="no-events">暂无物流轨迹</p>
              ) : (
                <ul className="timeline">
                  {detailShipment.events.map((event) => (
                    <li key={event.id}>
                      <span>{event.time}</span>
                      <div>
                        <p>{event.location}</p>
                        <small>{event.detail}</small>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      <button type="button" className="mobile-fab" onClick={() => setShowAddPanel(true)}>
        + 添加快递
      </button>
    </div>
  )
}

export default App
