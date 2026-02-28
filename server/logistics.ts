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

export interface LogisticsClient {
  query(trackingNumber: string): Promise<LogisticsSnapshot>
}

export interface Kuaidi100ClientOptions {
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

// 承运商名称映射
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
  dhl: 'DHL',
  fedex: 'FedEx',
  ups: 'UPS',
  tnt: 'TNT',
}

// 根据单号前缀推断承运商
function inferCarrierByPrefix(trackingNumber: string): string[] {
  const num = trackingNumber.toUpperCase()
  const carriers: string[] = []

  // 顺丰：SF开头
  if (num.startsWith('SF')) {
    carriers.push('shunfeng')
  }
  // 圆通：YT开头
  if (num.startsWith('YT')) {
    carriers.push('yuantong')
  }
  // 韵达：YD开头 或 10/11/12/14/15/16/17/18/19开头的13位数字
  if (num.startsWith('YD') || (/^(10|11|12|14|15|16|17|18|19)\d{11}$/.test(num) && num.length >= 13)) {
    carriers.push('yunda')
  }
  // 中通：多种前缀 731/732/733/734/735/736/737/738/739/753/761/762/763/773/781/782/783/785/786/787/788/789/536/538/589/571/568/757/758/764/765/766/767/768/776/778/789
  if (/^(731|732|733|734|735|736|737|738|739|753|757|758|761|762|763|764|765|766|767|768|773|776|778|781|782|783|785|786|787|788|789|536|538|568|571|589|757|758)/.test(num) || num.startsWith('ZT')) {
    carriers.push('zhongtong')
  }
  // 申通：268/368/468/668/768/868/666/772开头 或 ST开头
  if (num.startsWith('ST') || /^(268|368|468|668|768|868|666|772|330|335|338|339|350|351|352|353|355|356|357|362|365|366|367|369|370|371)\d+$/.test(num)) {
    carriers.push('shentong')
  }
  // 京东：JD开头
  if (num.startsWith('JD')) {
    carriers.push('jd')
  }
  // 极兔：JT开头
  if (num.startsWith('JT')) {
    carriers.push('jtexpress')
  }
  // 邮政/EMS：E开头字母+数字 或 95/96/99开头
  if (/^E[A-Z]\d{9,}[A-Z]{2}$/.test(num) || /^(95|96|99)\d{9,}$/.test(num)) {
    carriers.push('ems', 'youzhengguonei')
  }
  // 德邦：DP或DE开头
  if (num.startsWith('DP') || num.startsWith('DE')) {
    carriers.push('debangwuliu')
  }
  // 百世：555开头
  if (num.startsWith('555')) {
    carriers.push('huitongkuaidi')
  }
  // 天天：560/561/562开头
  if (/^56[012]/.test(num)) {
    carriers.push('tiantian')
  }
  // 优速：518开头
  if (num.startsWith('518')) {
    carriers.push('yousuwuliu')
  }

  return carriers
}

function mapStateToStatus(state: string | undefined, hasEvents: boolean): ShipmentStatus {
  switch (state) {
    case '1':
      return '揽收中'
    case '0':
      return '运输中'
    case '5':
      return '派送中'
    case '3':
      return '已签收'
    case '2':
    case '4':
    case '6':
      return '异常'
    default:
      return hasEvents ? '运输中' : '已下单'
  }
}

function normalizeEvents(list: KuaidiTraceItem[] | undefined): LogisticsEvent[] {
  if (!Array.isArray(list)) {
    return []
  }

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
  const first = events.at(-1)
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
  const normalizedCode = code.toLowerCase()
  return autoName || CARRIER_NAME_MAP[normalizedCode] || code
}

function createSign(param: string, key: string, customer: string): string {
  const raw = `${param}${key}${customer}`
  return createHash('md5').update(raw).digest('hex').toUpperCase()
}

function hasPollCredential(options: Kuaidi100ClientOptions): boolean {
  return Boolean(options.key?.trim() && options.customer?.trim())
}

export function createKuaidi100Client(options: Kuaidi100ClientOptions = {}): LogisticsClient {
  async function autoDetectCarrier(trackingNumber: string): Promise<KuaidiAutoItem[]> {
    const url = `https://www.kuaidi100.com/autonumber/autoComNum?resultv2=1&text=${encodeURIComponent(trackingNumber)}`
    const response = await fetch(url)
    if (!response.ok) {
      return []
    }

    const payload = (await response.json()) as KuaidiAutoResp
    if (payload.returnCode === '200' && Array.isArray(payload.auto)) {
      return payload.auto
    }

    return []
  }

  async function queryByCarrier(trackingNumber: string, carrierCode: string): Promise<KuaidiQueryResp | null> {
    const url = `https://www.kuaidi100.com/query?type=${encodeURIComponent(carrierCode)}&postid=${encodeURIComponent(trackingNumber)}`
    const response = await fetch(url)
    if (!response.ok) {
      return null
    }

    const payload = (await response.json()) as KuaidiQueryResp
    if (payload.status !== '200') {
      return null
    }

    return payload
  }

  async function queryByPoll(trackingNumber: string, carrierCode: string): Promise<KuaidiQueryResp | null> {
    if (!hasPollCredential(options)) {
      return null
    }

    const key = options.key!.trim()
    const customer = options.customer!.trim()

    const paramObject = {
      com: carrierCode,
      num: trackingNumber,
      phone: options.phone?.trim() ?? '',
      from: options.shipFrom?.trim() ?? '',
      to: options.shipTo?.trim() ?? '',
      resultv2: '1',
      show: '0',
      order: 'desc',
    }

    const param = JSON.stringify(paramObject)
    const sign = createSign(param, key, customer)

    const form = new URLSearchParams()
    form.set('customer', customer)
    form.set('param', param)
    form.set('sign', sign)

    const response = await fetch('https://poll.kuaidi100.com/poll/query.do', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    })

    if (!response.ok) {
      return null
    }

    const payload = (await response.json()) as KuaidiQueryResp
    if (payload.status !== '200') {
      return null
    }

    return payload
  }

  return {
    async query(trackingNumber: string): Promise<LogisticsSnapshot> {
      // 1. 先尝试快递100自动识别接口
      const autoCandidates = await autoDetectCarrier(trackingNumber).catch(() => [])

      // 2. 根据单号前缀推断可能的承运商
      const inferredCodes = inferCarrierByPrefix(trackingNumber)

      // 3. 合并候选列表（自动识别结果优先，然后是推断结果）
      const candidates: KuaidiAutoItem[] = []

      // 添加自动识别结果
      for (const item of autoCandidates) {
        if (item.comCode && !candidates.some((c) => c.comCode === item.comCode)) {
          candidates.push(item)
        }
      }

      // 添加推断结果
      for (const code of inferredCodes) {
        if (!candidates.some((c) => c.comCode === code)) {
          candidates.push({ comCode: code })
        }
      }

      // 4. 遍历候选承运商查询物流
      for (const candidate of candidates) {
        // 优先使用签名接口（需要配置key和customer）
        const pollPayload = await queryByPoll(trackingNumber, candidate.comCode).catch(() => null)
        const payload = pollPayload ?? (await queryByCarrier(trackingNumber, candidate.comCode).catch(() => null))
        if (!payload) {
          continue
        }

        const events = normalizeEvents(payload.data)
        // 必须有轨迹数据才认为识别成功
        if (events.length > 0) {
          const carrierCode = payload.com || candidate.comCode
          const carrierName = toCarrierName(carrierCode, candidate.comName)
          console.log(`[物流查询] 单号 ${trackingNumber} 识别为: ${carrierName} (${carrierCode})`)
          return buildSnapshot(carrierCode, carrierName, payload)
        }
      }

      // 5. 如果全部失败，抛出错误
      throw new Error('未查询到物流信息，请确认单号是否正确。')
    },
  }
}
