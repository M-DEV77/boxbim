// Zera as contas do servidor: apaga usuários, sessões, participantes, presets, conjuntos de ferramentas e os
// projetos (com os elementos e as cópias de objetos). A biblioteca geral de objetos e as configurações ficam.
// A próxima conta cadastrada vira administradora.
//
//   npm run zerar-contas -- --sim        (sem --sim só mostra o que seria apagado)
//
// Antes de apagar, copia o banco para <dados>/.servidor/backup-<data>/ (para voltar atrás: pare o servidor e
// copie os arquivos de volta).
'use strict';
const fs = require('fs');
const path = require('path');
const db = require('../db');

async function main() {
  const apply = process.argv.includes('--sim');
  await db.init();
  const counts = {
    usuarios: await db.Usuario.count(), sessoes: await db.Sessao.count(), projetos: await db.Projeto.count(),
    elementos: await db.Elemento.count(), membros: await db.Membro.count(), presets: await db.Preset.count(),
  };
  const projetos = (await db.Projeto.findAll({ attributes: ['nome'] })).map(p => p.nome);
  console.log('Banco:', db.storage);
  console.log('Será apagado:', counts, projetos.length ? `\nProjetos: ${projetos.join(', ')}` : '');
  if (!apply) { console.log('\nNada foi apagado. Para apagar de verdade: npm run zerar-contas -- --sim'); return; }

  // cópia de segurança (banco + arquivos do modo WAL)
  const dir = path.join(path.dirname(db.storage), `backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const ext of ['', '-wal', '-shm']) {
    const f = db.storage + ext;
    if (fs.existsSync(f)) fs.copyFileSync(f, path.join(dir, path.basename(f)));
  }
  console.log('Cópia de segurança:', dir);

  await db.sequelize.transaction(async transaction => {
    for (const M of [db.Elemento, db.ObjetoProjeto, db.Membro, db.Projeto, db.Preset, db.Ferramentas, db.Sessao, db.Usuario]) {
      await M.destroy({ where: {}, transaction });
    }
  });
  console.log('Contas zeradas. A próxima conta cadastrada será a administradora.');
}

main().then(() => db.sequelize.close()).catch(e => { console.error(e); process.exit(1); });
