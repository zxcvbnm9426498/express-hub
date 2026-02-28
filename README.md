# Express Hub - 快递聚合展示平台

一个前后端一体的快递物流聚合系统，支持自动识别快递公司并追踪物流。

## 技术栈

- **前端**: React 19 + TypeScript + Vite
- **后端**: Vercel Serverless Functions
- **数据库**: PostgreSQL (Neon)

## 功能

- 自动识别快递公司
- 实时物流追踪
- 物流轨迹时间线
- 响应式设计
- 状态统计面板

## 本地开发

```bash
npm install
npm run dev
```

## Vercel 部署

### 1. 环境变量配置

在 Vercel Dashboard 中配置以下环境变量：

| 变量名 | 说明 | 必填 |
|--------|------|------|
| `POSTGRES_URL` | PostgreSQL 连接字符串 | ✅ |
| `KD100_KEY` | 快递100 授权 key | ❌ |
| `KD100_CUSTOMER` | 快递100 客户编号 | ❌ |

### 2. 部署

```bash
vercel --prod
```

或直接在 Vercel Dashboard 导入 GitHub 仓库。

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/shipments` | 获取运单列表 |
| POST | `/api/shipments` | 创建运单 |
| PATCH | `/api/shipments/:id/sync` | 同步物流 |

## License

MIT
