// Página de login e cadastro.
const $ = s => document.querySelector(s);
const volta = new URLSearchParams(location.search).get('volta');
const destino = volta && volta.startsWith('/') && !volta.startsWith('//') ? volta : '/projetos.html';

function show(tab) {
  document.querySelectorAll('.auth-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#form-login').hidden = tab !== 'login';
  $('#form-cadastro').hidden = tab !== 'cadastro';
  $('#msg').hidden = true;
}
document.querySelectorAll('.auth-tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));

function message(text, ok = false) {
  const m = $('#msg');
  m.textContent = text;
  m.className = `msg ${ok ? 'ok' : 'error'}`;
  m.hidden = false;
}

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`);
  return j;
}

$('#form-login').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  try { await post('/api/auth/login', { email: f.get('email'), senha: f.get('senha') }); location.href = destino; }
  catch (err) { message(err.message); }
});

$('#form-cadastro').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  if (f.get('senha') !== f.get('senha2')) return message('As senhas não conferem.');
  try { await post('/api/auth/cadastro', { nome: f.get('nome'), email: f.get('email'), senha: f.get('senha'), codigo: f.get('codigo') || '' }); location.href = destino; }
  catch (err) { message(err.message); }
});

// já logado: vai direto
fetch('/api/auth/eu', { credentials: 'same-origin' }).then(r => { if (r.ok) location.href = destino; });
if (location.hash === '#cadastro') show('cadastro');
// servidor com código de cadastro (convite): mostra o campo
fetch('/api/auth/config').then(r => r.json()).then(c => { const el = document.getElementById('campo-codigo'); if (el && c.codigoCadastro) { el.hidden = false; el.querySelector('input').required = true; } }).catch(() => {});
