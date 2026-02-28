import { createApp } from './app.ts'
import { createDatabase, resolveDatabasePath } from './database.ts'
import { createKuaidi100Client } from './logistics.ts'

const dbPath = resolveDatabasePath(process.env.DB_PATH)
const db = createDatabase(dbPath)
const app = createApp(db, {
  dbPathForHealth: dbPath,
  logisticsClient: createKuaidi100Client({
    key: process.env.KD100_KEY,
    customer: process.env.KD100_CUSTOMER,
    phone: process.env.KD100_PHONE,
    shipFrom: process.env.KD100_FROM,
    shipTo: process.env.KD100_TO,
  }),
})

const port = Number(process.env.PORT ?? 8787)
const server = app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`)
  console.log(`SQLite DB: ${dbPath}`)
})

function shutdown() {
  server.close(() => {
    db.close()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
