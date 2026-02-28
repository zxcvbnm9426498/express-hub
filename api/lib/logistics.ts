import { createHash } from 'node:crypto'

export type ShipmentStatus = '已下单' | '揽收中' | '运输中' | '派送中' | '已签收' | '异常'

export interface LogisticsEvent {
  time: string
  location: string
  detail: string
}

export interface LogisticsSnapshot {
  carrierCode: string
  carrierName: string
  status: ShipmentStatus
  latestUpdate: string
  latestContext: string
  routeFrom: string
  routeTo: string
  eta: string
  events: LogisticsEvent[]
}

export interface Kuaidi100Options {
  key?: string
  customer?: string
  phone?: string
  shipFrom?: string
  shipTo?: string
}

interface KuaidiAutoItem {
  comCode: string
  comName?: string
}

interface KuaidiAutoResp {
  returnCode?: string
  auto?: KuaidiAutoItem[]
}

interface KuaidiTraceItem {
  time?: string
  ftime?: string
  context?: string
  location?: string
}

interface KuaidiQueryResp {
  status?: string
  state?: string
  message?: string
  com?: string
  data?: KuaidiTraceItem[]
}

const CARRIER_NAME_MAP: Record<string, string> = {
  shunfeng: '顺丰速运',
  sf: '顺丰速运',
  zhongtong: '中通快递',
  zto: '中通快递',
  yuantong: '圆通快递',
  yto: '圆通快递',
  yunda: '韵达快递',
  shentong: '申通快递',
  sto: '申通快递',
  jd: '京东物流',
  jingdong: '京东物流',
  debangwuliu: '德邦快递',
  debang: '德邦快递',
  youzhengguonei: '中国邮政',
  ems: 'EMS',
  jtexpress: '极兔速递',
  jt: '极兔速递',
  tiantian: '天天快递',
  huitongkuaidi: '百世快递',
  best: '百世快递',
  uc: '优速快递',
  yousuwuliu: '优速快递',
  zhaijisong: '宅急送',
  zjs: '宅急送',
}

function inferCarrierByPrefix(trackingNumber: string): string[] {
  const num = trackingNumber.toUpperCase()
  const carriers: string[] = []

  if (num.startsWith('SF')) carriers.push('shunfeng')
  if (num.startsWith('YT')) carriers.push('yuantong')
  if (num.startsWith('YD') || (/^(10|11|12|14|15|16|17|18|19)\d{11}$/.test(num) && num.length >= 13)) carriers.push('yunda')
  if (/^(731|732|733|734|735|736|737|738|739|753|757|758|761|762|763|764|765|766|767|768|773|776|778|781|782|783|785|786|787|788|789|536|538|568|571|589)/.test(num) || num.startsWith('ZT')) carriers.push('zhongtong')
  if (num.startsWith('ST') || /^(268|368|468|668|768|868|666|772|330|335|338|339|350|351|352|353|355|356|357|362|365|366|367|369|370|371)\d+$/.test(num)) carriers.push('shentong')
  if (num.startsWith('JD')) carriers.push('jd')
  if (num.startsWith('JT')) carriers.push('jtexpress')
  if (/^E[A-Z]\d{9,}[A-Z]{2}$/.test(num) || /^(95|96|99)\d{9,}$/.test(num)) carriers.push('ems', 'youzhengguonei')
  if (num.startsWith('DP') || num.startsWith('DE')) carriers.push('debangwuliu')
  if (num.startsWith('555')) carriers.push('huitongkuaidi')
  if (/^56[012]/.test(num)) carriers.push('tiantian')
  if (num.startsWith('518')) carriers.push('yousuwuliu')

  return carriers
}

function mapStateToStatus(state: string | undefined, hasEvents: boolean): ShipmentStatus {
  switch (state) {
    case '1': return '揽收中'
    case '0': return '运输中'
    case '5': return '派送中'
    case '3': return '已签收'
    case '2':
    case '4':
    case '6': return '异常'
    default: return hasEvents ? '运输中' : '已下单'
  }
}

function normalizeEvents(list: KuaidiTraceItem[] | undefined): LogisticsEvent[] {
  if (!Array.isArray(list)) return []

  return list
    .map((item) => ({
      time: item.ftime || item.time || '-',
      location: item.location || '物流节点',
      detail: item.context || '暂无详细描述',
    }))
    .filter((item) => item.time !== '-' || item.detail !== '暂无详细描述')
}

function buildSnapshot(carrierCode: string, carrierName: string, payload: KuaidiQueryResp): LogisticsSnapshot {
  const events = normalizeEvents(payload.data)
  const latest = events[0]
  const first = events.length > 0 ? events[events.length - 1] : null
  const status = mapStateToStatus(payload.state, events.length > 0)

  return {
    carrierCode,
    carrierName,
    status,
    latestUpdate: latest?.time || '-',
    latestContext: latest?.detail || '暂无物流轨迹，请稍后重试。',
    routeFrom: first?.location || '未知',
    routeTo: latest?.location || '未知',
    eta: status === '已签收' ? '已签收' : status === '派送中' ? '派送中，请注意查收' : '以物流更新为准',
    events,
  }
}

function toCarrierName(code: string, autoName?: string): string {
  return autoName || CARRIER_NAME_MAP[code.toLowerCase()] || code
}

function createSign(param: string, key: string, customer: string): string {
  return createHash('md5').update(`${param}${key}${customer}`).digest('hex').toUpperCase()
}

export async function queryLogistics(trackingNumber: string, options: Kuaidi100Options = {}): Promise<LogisticsSnapshot> {
  // 自动识别
  const autoCandidates: KuaidiAutoItem[] = []
  try {
    const autoUrl = `https://www.kuaidi100.com/autonumber/autoComNum?resultv2=1&text=${encodeURIComponent(trackingNumber)}`
    const autoRes = await fetch(autoUrl)
    if (autoRes.ok) {
      const autoData = (await autoRes.json()) as KuaidiAutoResp
      if (autoData.returnCode === '200' && Array.isArray(autoData.auto)) {
        autoCandidates.push(...autoData.auto)
      }
    }
  } catch { /* ignore */ }

  // 前缀推断
  const inferredCodes = inferCarrierByPrefix(trackingNumber)

  // 合并候选
  const candidates: KuaidiAutoItem[] = [...autoCandidates]
  for (const code of inferredCodes) {
    if (!candidates.some((c) => c.comCode === code)) {
      candidates.push({ comCode: code })
    }
  }

  // 查询
  for (const candidate of candidates) {
    let payload: KuaidiQueryResp | null = null

    // 签名接口
    if (options.key && options.customer) {
      const paramObject = {
        com: candidate.comCode,
        num: trackingNumber,
        phone: options.phone?.trim() ?? '',
        from: options.shipFrom?.trim() ?? '',
        to: options.shipTo?.trim() ?? '',
        resultv2: '1',
        show: '0',
        order: 'desc',
      }
      const param = JSON.stringify(paramObject)
      const sign = createSign(param, options.key, options.customer)

      try {
        const form = new URLSearchParams()
        form.set('customer', options.customer)
        form.set('param', param)
        form.set('sign', sign)

        const pollRes = await fetch('https://poll.kuaidi100.com/poll/query.do', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form,
        })

        if (pollRes.ok) {
          const pollData = (await pollRes.json()) as KuaidiQueryResp
          if (pollData.status === '200') {
            payload = pollData
          }
        }
      } catch { /* ignore */ }
    }

    // 免费接口
    if (!payload) {
      try {
        const queryUrl = `https://www.kuaidi100.com/query?type=${encodeURIComponent(candidate.comCode)}&postid=${encodeURIComponent(trackingNumber)}`
        const queryRes = await fetch(queryUrl)
        if (queryRes.ok) {
          const queryData = (await queryRes.json()) as KuaidiQueryResp
          if (queryData.status === '200') {
            payload = queryData
          }
        }
      } catch { /* ignore */ }
    }

    if (!payload) continue

    const events = normalizeEvents(payload.data)
    if (events.length > 0) {
      const carrierCode = payload.com || candidate.comCode
      const carrierName = toCarrierName(carrierCode, candidate.comName)
      return buildSnapshot(carrierCode, carrierName, payload)
    }
  }

  throw new Error('未查询到物流信息，请确认单号是否正确。')
}
