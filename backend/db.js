const Database = require('better-sqlite3');
const path = require('path');
const { randomUUID } = require('crypto');

const db = new Database(process.env.DATABASE_PATH || path.join(__dirname, 'festa.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS tickets(
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  type_label TEXT NOT NULL,
  price REAL NOT NULL,
  buyer_name TEXT NOT NULL,
  buyer_email TEXT,
  buyer_cpf TEXT,
  status TEXT NOT NULL DEFAULT 'aguardando_pagamento',
  created_at TEXT NOT NULL,
  checked_in_at TEXT
);
CREATE TABLE IF NOT EXISTS payments(
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  method TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  gateway_ref TEXT,
  pix_copia_cola TEXT,
  created_at TEXT NOT NULL,
  confirmed_at TEXT
);
CREATE TABLE IF NOT EXISTS wallets(
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  balance REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ativa',
  qr_data_url TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wallet_transactions(
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS ticket_lots(
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  price REAL NOT NULL,
  capacity INTEGER,
  sector_label TEXT,
  quantity_total INTEGER NOT NULL,
  quantity_sold INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS bar_sales(
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL,
  total REAL NOT NULL,
  lookup_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'retirado',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bar_sale_items(
  id TEXT PRIMARY KEY,
  bar_sale_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL
);
`);

// Migracoes: colunas adicionadas depois da primeira versao do banco.
function addColumn(table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn('payments', 'provider', "TEXT NOT NULL DEFAULT 'simulado'");
addColumn('payments', 'checkout_url', 'TEXT');
addColumn('payments', 'expires_at', 'TEXT');

db.exec(`
CREATE INDEX IF NOT EXISTS idx_tickets_cpf ON tickets(buyer_cpf);
CREATE INDEX IF NOT EXISTS idx_payments_ticket ON payments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_wallets_ticket ON wallets(ticket_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet ON wallet_transactions(wallet_id);
`);

if (!db.prepare('SELECT COUNT(*) c FROM products').get().c) {
  const add = db.prepare('INSERT INTO products VALUES(?,?,?,?,?,1)');
  [
    ['Cerveja long neck', 'bebida', 12, 500],
    ['Agua mineral', 'bebida', 6, 300],
    ['Refrigerante lata', 'bebida', 8, 300],
    ['Drink especial', 'bebida', 25, 200],
    ['Porcao de batata frita', 'alimentacao', 30, 100],
    ['Hamburguer', 'alimentacao', 28, 150],
  ].forEach((p) => add.run(randomUUID(), ...p));
}

if (!db.prepare('SELECT COUNT(*) c FROM ticket_lots').get().c) {
  const add = db.prepare('INSERT INTO ticket_lots VALUES(?,?,?,?,?,?,?,0,1)');
  [
    ['ingresso', '1º lote', 120, null, null, 100],
    ['ingresso', '2º lote', 160, null, null, 100],
    ['ingresso', '3º lote', 200, null, null, 100],
    // Cortesia: gratuita e emitida somente pela equipe (nao aparece no site).
    ['cortesia', 'Cortesia', 0, null, null, 100],
  ].forEach((l) => add.run(randomUUID(), ...l));
}

module.exports = db;
