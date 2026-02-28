# 快递聚合展示平台（TypeScript）

一个前后端一体的快递聚合系统：
- 前端：React + TypeScript + Vite
- 后端：Express + TypeScript
- 数据库：SQLite（Node 内置 `node:sqlite`）
- 物流查询：服务端调用快递 API（当前实现：Kuaidi100）

## 当前录入方式

添加快递时仅需输入：
- 快递单号
- 发货日期

提交后后端会自动调用物流 API 获取：
- 承运商
- 当前状态
- 最新物流动态
- 轨迹列表

并持久化到 SQLite。

## 本地启动

```bash
npm install
npm run dev
```

`npm run dev` 会同时启动：
- 前端：`http://localhost:5173`（端口占用会自动切换）
- 后端：`http://localhost:8787`

## 环境变量

- `VITE_API_BASE_URL`：前端直连 API 地址（默认空，走同源 `/api`）
- `VITE_PROXY_TARGET`：Vite 开发代理目标，默认 `http://localhost:8787`
- `DB_PATH`：SQLite 路径（默认 `data/shipment-hub.db`）
- `PORT`：后端端口（默认 `8787`）
- `KD100_KEY`：快递100 授权 key（可选）
- `KD100_CUSTOMER`：快递100 查询公司编号（可选）
- `KD100_PHONE`：手机号（可选，部分快递会要求）
- `KD100_FROM`：发货地（可选）
- `KD100_TO`：目的地（可选）

参考：`.env.example`

说明：如果配置了 `KD100_KEY + KD100_CUSTOMER`，后端会优先走你提供的签名查询接口
`https://poll.kuaidi100.com/poll/query.do`；未配置时会自动回退到普通查询接口。

## 数据库文件

默认 SQLite 文件路径：

`data/shipment-hub.db`

## 构建、检查、测试

```bash
npm run lint
npm run test:server
npm run build
```
