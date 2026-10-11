// Copia segura do banco SQLite (funciona com o site rodando) e apaga backups antigos.
// Uso: node deploy/backup.js <banco> <pasta-de-backup> [dias-para-manter]
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const [dbPath, dir, keepDays = '30'] = process.argv.slice(2);
if (!dbPath || !dir) {
  console.error('Uso: node deploy/backup.js <banco> <pasta> [dias]');
  process.exit(1);
}
if (!fs.existsSync(dbPath)) {
  console.log('Banco ainda nao existe, nada a copiar.');
  process.exit(0);
}

fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const target = path.join(dir, `festa-${stamp}.db`);

new Database(dbPath, { readonly: true })
  .backup(target)
  .then(() => {
    console.log(`Backup criado: ${target}`);
    const limit = Date.now() - Number(keepDays) * 86400000;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (/^festa-.*\.db$/.test(f) && fs.statSync(full).mtimeMs < limit) fs.unlinkSync(full);
    }
  })
  .catch((err) => {
    console.error('Falha no backup:', err.message);
    process.exit(1);
  });
