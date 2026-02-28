import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (columns.some((item) => item.name === column)) {
    return
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`)
}

export function resolveDatabasePath(dbPathFromEnv?: string): string {
  const fallbackPath = resolve(process.cwd(), 'data/shipment-hub.db')
  return dbPathFromEnv?.trim() ? resolve(process.cwd(), dbPathFromEnv) : fallbackPath
}

export function createDatabase(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true })

  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')

  db.exec(`
    CREATE TABLE IF NOT EXISTS shipments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      carrier TEXT NOT NULL,
      tracking_number TEXT NOT NULL UNIQUE,
      recipient TEXT NOT NULL,
      phone TEXT NOT NULL,
      route_from TEXT NOT NULL,
      route_to TEXT NOT NULL,
      status TEXT NOT NULL,
      latest_update TEXT NOT NULL,
      eta TEXT NOT NULL,
      items TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `)

  ensureColumn(db, 'shipments', 'carrier_code', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'shipments', 'shipping_date', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'shipments', 'latest_context', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'shipments', 'updated_at', "TEXT NOT NULL DEFAULT ''")

  db.exec(`
    CREATE TABLE IF NOT EXISTS tracking_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shipment_id INTEGER NOT NULL,
      event_time TEXT NOT NULL,
      location TEXT NOT NULL,
      detail TEXT NOT NULL,
      FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE
    );
  `)

  db.exec('CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);')
  db.exec('CREATE INDEX IF NOT EXISTS idx_shipments_carrier ON shipments(carrier);')
  db.exec('CREATE INDEX IF NOT EXISTS idx_shipments_shipping_date ON shipments(shipping_date DESC, id DESC);')
  db.exec('CREATE INDEX IF NOT EXISTS idx_shipments_created_at ON shipments(created_at DESC, id DESC);')
  db.exec('CREATE INDEX IF NOT EXISTS idx_tracking_events_shipment ON tracking_events(shipment_id, id DESC);')

  return db
}
