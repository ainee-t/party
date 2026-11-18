const express = require('express'), http = require('http'), crypto = require('crypto'), path = require('path');
const { Server } = require('socket.io');
const app = express(), server = http.createServer(app), io = new Server(server, { maxHttpBufferSize: 1e4, pingInterval: 10000, pingTimeout: 8000 });
app.disable('x-powered-by');
app.use((req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN' }); next(); });
app.get('/healthz', (req, res) => res.send('ok'));
process.on('uncaughtException', e => console.error('Váratlan hiba (a szerver fut tovább):', e));
process.on('unhandledRejection', e => console.error('Elutasított ígéret:', e));
const safe = fn => (...a) => { try { return fn(...a); } catch (e) { console.error('Hiba:', e); } };
// Találgatás-védelem: IP-nként percenként legfeljebb 30 sikertelen csatlakozási/hitelesítési kísérlet (az utolsó X-Forwarded-For elem a proxy által látott kliens)
const failLog = new Map();
const ipOf = s => { const x = String(s.handshake.headers['x-forwarded-for'] || '').split(',').pop().trim(); return x || s.handshake.address; };
const recent = ip => { const n = Date.now(), a = (failLog.get(ip) || []).filter(t => n - t < 60000); failLog.set(ip, a); return a; };
const blocked = s => recent(ipOf(s)).length >= 30;
const noteFail = s => { recent(ipOf(s)).push(Date.now()); };
const BLOCKED = { error: 'Túl sok sikertelen próbálkozás, várj egy percet.' };
app.use(express.static(path.join(__dirname, 'public')));
const fs = require('fs');
// Kérdésbank: a questions/ mappa minden *.json fájlja egy kategória. Kérés/játék létrehozás előtt újraolvassuk, így újraindítás nélkül szerkeszthető.
const QDIR = path.join(__dirname, 'questions');
function loadBank() {
  const cats = [];
  for (const f of fs.readdirSync(QDIR).filter(f => f.endsWith('.json')).sort()) {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(QDIR, f), 'utf8'));
      const id = String(c.id || f.replace(/^\d+-|\.json$/g, ''));
      const qs = [...new Set((c.questions || []).map(q => String(q).trim()).filter(Boolean))];
      cats.push({ id, name: String(c.name || id), emoji: String(c.emoji || '❓'),
        items: qs.map(q => ({ id: id + ':' + crypto.createHash('md5').update(q).digest('hex').slice(0, 6), q })) });
    } catch (e) { console.warn('Hibás kérdésfájl, kihagyva:', f, e.message); }
  }
  return cats;
}
app.get('/api/questions', (req, res) => res.json(loadBank()));
// Kiválasztott kategóriák − kizárt kérdések (+ saját kérdések, amik mindig bekerülnek), opcionális keverés
function buildQuestions(d) {
  const arr = x => Array.isArray(x) ? x : [];
  const want = arr(d.categories).length ? new Set(arr(d.categories).map(String)) : null;
  const excl = new Set(arr(d.exclude).map(String));
  const custom = [...new Set(arr(d.custom).map(x => String(x).trim().slice(0, 140)).filter(Boolean))].slice(0, 40);
  const shuf = d.shuffle !== false;
  let pool = loadBank().filter(c => !want || want.has(c.id)).flatMap(c => c.items.map(i => ({ id: i.id, q: i.q, cat: c.id }))).filter(i => !excl.has(i.id)).map(({ q, cat }) => ({ q, cat }));
  if (shuf) pool = shuffle(pool);
  const total = Math.max(clamp(d.count, 3, 60), custom.length);
  const list = [...custom.map(q => ({ q, cat: 'custom' })), ...pool.slice(0, total - custom.length)];
  return shuf ? shuffle(list) : list;
}
const rooms = new Map();
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GRACE = 300; // ms türelmi idő a hálózati késésre
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const rid = n => crypto.randomBytes(n).toString('hex');
const clamp = (v, a, b) => Math.min(b, Math.max(a, Number(v) || a));
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function newCode() { let c; do { c = Array.from({ length: 4 }, () => ALPHA[crypto.randomInt(ALPHA.length)]).join(''); } while (rooms.has(c)); return c; }

const DEF_CAP = { win: ['Mindannyian tudtuk.'], tie: ['Holtverseny!'], none: ['Senki sem szavazott.'] };
function pickCaption(kind) { // captions.json menet közben szerkeszthető
  let c = DEF_CAP; try { c = JSON.parse(fs.readFileSync(path.join(__dirname, 'captions.json'), 'utf8')); } catch (e) {}
  const a = Array.isArray(c[kind]) && c[kind].length ? c[kind] : DEF_CAP[kind]; return String(a[crypto.randomInt(a.length)]);
}
// Címek: kategóriánkénti szavazatok alapján. Döntetlennél a cím közös, nem választunk önkényesen.
function awards(r) {
  const tot = {}, wins = {}, self = {}, cat = {};
  r.players.forEach(p => { tot[p.id] = 0; wins[p.id] = 0; self[p.id] = 0; cat[p.id] = {}; });
  r.history.forEach(h => { for (const k in h.tallies) { tot[k] += h.tallies[k]; cat[k][h.cat] = (cat[k][h.cat] || 0) + h.tallies[k]; } h.winners.forEach(w => wins[w]++); h.self.forEach(x => self[x]++); });
  const sc = (id, cs) => cs.reduce((a, c) => a + (cat[id][c] || 0), 0);
  const DEFS = [['👹', 'A társaság réme', id => tot[id]], ['🚩', 'A sétáló vörös zászló', id => sc(id, ['dating'])],
    ['💥', 'Az élő katasztrófa', id => sc(id, ['chaos', 'cringe', 'party'])], ['🕵️', 'A legkeresettebb', id => sc(id, ['secrets', 'dark'])],
    ['🎬', 'Főszereplő-szindróma', id => self[id]]];
  const titles = {};
  for (const [e, t, f] of DEFS) {
    const free = r.players.filter(p => !titles[p.id] && tot[p.id] > 0), m = Math.max(0, ...free.map(p => f(p.id)));
    if (m > 0) free.filter(p => f(p.id) === m).forEach(p => { titles[p.id] = { e, t }; });
  }
  r.players.forEach(p => { if (!titles[p.id]) titles[p.id] = tot[p.id] ? { e: '🤫', t: 'Csendes gyanúsított' } : { e: '😇', t: 'Az ártatlan', s: 'senki sem szavazott rá' }; });
  return { totals: tot, wins, titles, history: r.history.map(h => ({ q: h.q, winners: h.winners })) };
}
// Egyéni szavazatok SOHA nem kerülnek ki a szerverről a felfedésig; csak darabszám.
function snap(r, m) {
  const claimed = r.players.filter(p => p.secret);
  const s = { code: r.code, state: r.state, now: Date.now(), total: r.questions.length, qi: r.qi,
    players: r.players.map(p => ({ id: p.id, name: p.name, claimed: !!p.secret, online: !!p.socketId })),
    settings: { timer: r.timer, allowSelf: r.allowSelf, drama: r.drama, sound: r.sound }, round: r.round, paused: r.paused, voted: r.votes.size, eligible: claimed.length };
  if (r.state === 'question' || r.state === 'reveal') { s.q = r.questions[r.qi].q; s.endsAt = r.endsAt; if (r.paused) s.left = r.left; }
  if (r.state === 'reveal') s.reveal = r.reveal;
  if (r.state === 'finished') s.awards = awards(r);
  if (m.role === 'player') { s.me = m.playerId; s.myVote = r.votes.get(m.playerId) || null; }
  return s;
}
function send(r) { r.touched = Date.now(); for (const [sid, m] of r.members) io.to(sid).emit('state', snap(r, m)); }
function attach(socket, r, role, playerId) {
  for (const [sid, m] of r.members) if (role === 'host' ? m.role === 'host' : m.playerId === playerId) r.members.delete(sid);
  socket.data = { code: r.code, role, playerId };
  r.members.set(socket.id, { role, playerId });
  if (role === 'player') r.players.find(p => p.id === playerId).socketId = socket.id;
}
function openNext(r) {
  clearTimeout(r.timeout); r.paused = false;
  r.qi++;
  if (r.qi >= r.questions.length) { r.state = 'finished'; return send(r); }
  r.state = 'question'; r.round++; r.votes = new Map(); r.reveal = null;
  r.endsAt = Date.now() + r.timer * 1000;
  r.timeout = setTimeout(safe(() => closeVoting(r)), r.timer * 1000 + GRACE);
  send(r);
}
function closeVoting(r) {
  if (r.state !== 'question') return;
  clearTimeout(r.timeout);
  const t = {}; r.players.forEach(p => { t[p.id] = 0; });
  r.votes.forEach(v => { t[v]++; });
  const max = Math.max(0, ...Object.values(t));
  const winners = max ? Object.keys(t).filter(k => t[k] === max) : [];
  const cur = r.questions[r.qi], kind = !winners.length ? 'none' : winners.length > 1 ? 'tie' : 'win';
  r.paused = false;
  r.reveal = { tallies: t, winners, cast: r.votes.size, at: Date.now(), caption: r.drama ? pickCaption(kind) : null };
  r.history.push({ q: cur.q, cat: cur.cat, tallies: t, winners, self: [...r.votes].filter(([v, x]) => v === x).map(([v]) => v) });
  r.state = 'reveal'; send(r);
}
function maybeEarly(r) {
  const on = r.players.filter(p => p.secret && p.socketId);
  if (on.length && on.every(p => r.votes.has(p.id))) { clearTimeout(r.timeout); r.timeout = setTimeout(safe(() => closeVoting(r)), 800); }
}

io.on('connection', socket => {
  let hits = 0; const iv = setInterval(() => { hits = 0; }, 10000); socket.on('disconnect', () => clearInterval(iv));
  const on = (ev, fn) => socket.on(ev, (d, ack) => {            // kérésszám-korlát + típusellenőrzés
    ack = typeof ack === 'function' ? ack : () => {};
    if (ev !== 'disconnect' && ++hits > 80) return ack({ error: 'Túl sok kérés, lassíts.' });
    try { fn(d && typeof d === 'object' ? d : {}, ack); } catch (e) { console.error('Hiba (' + ev + '):', e); ack({ error: 'Szerverhiba, próbáld újra.' }); }
  });
  on('time:sync', (d, ack) => ack({ now: Date.now() }));
  const room = () => rooms.get(socket.data?.code);
  const hostRoom = () => { const r = room(); return r && socket.data.role === 'host' ? r : null; };

  on('host:create', (d, ack) => {
    const seen = new Set(), names = (Array.isArray(d.names) ? d.names : []).map(s => String(s).trim().slice(0, 20)).filter(n => { const k = n.toLowerCase(); if (!n || seen.has(k)) return false; seen.add(k); return true; }).slice(0, 20);
    if (names.length < 2) return ack({ error: 'Legalább 2 név kell.' });
    const qs = buildQuestions(d); if (!qs.length) return ack({ error: 'Nincs kiválasztott kérdés.' });
    if (rooms.size >= 500) return ack({ error: 'A szerver tele van.' });
    const code = newCode();
    const r = { code, hostToken: rid(16), state: 'lobby', questions: qs, round: 0, paused: false, left: 0, drama: d.drama !== false, sound: d.sound !== false,
      opts: { categories: d.categories, exclude: d.exclude, custom: d.custom, shuffle: d.shuffle, count: d.count }, qi: -1, votes: new Map(), endsAt: 0, history: [], reveal: null,
      timeout: null, touched: Date.now(), members: new Map(), timer: clamp(d.timer, 5, 60),
      allowSelf: d.allowSelf !== false, players: names.map(n => ({ id: rid(4), name: n, secret: null, socketId: null })) };
    rooms.set(code, r); attach(socket, r, 'host'); ack({ code, hostToken: r.hostToken }); send(r);
  });
  on('host:rejoin', (d, ack) => {
    if (blocked(socket)) return ack(BLOCKED);
    const r = rooms.get(String(d.code || '').toUpperCase());
    if (!r || !same(r.hostToken, d.hostToken)) { noteFail(socket); return ack({ error: 'Nincs ilyen szoba.' }); }
    attach(socket, r, 'host'); ack({ ok: true }); send(r);
  });
  on('host:start', (d, ack) => {
    const r = hostRoom(); if (!r || r.state !== 'lobby') return;
    if (r.players.filter(p => p.secret).length < 2) return ack({ error: 'Legalább 2 csatlakozott játékos kell.' });
    r.qi = -1; openNext(r);
  });
  on('host:endVoting', () => { const r = hostRoom(); if (r) closeVoting(r); });
  on('host:skip', () => { const r = hostRoom(); if (r && r.state === 'question') openNext(r); });
  on('host:next', () => { const r = hostRoom(); if (r && r.state === 'reveal') openNext(r); });
  on('host:pause', () => { const r = hostRoom(); if (!r || r.state !== 'question' || r.paused) return; clearTimeout(r.timeout); r.left = Math.max(0, r.endsAt - Date.now()); r.paused = true; send(r); });
  on('host:resume', () => { const r = hostRoom(); if (!r || !r.paused) return; r.paused = false; r.endsAt = Date.now() + r.left; r.timeout = setTimeout(safe(() => closeVoting(r)), r.left + GRACE); send(r); maybeEarly(r); });
  on('host:redo', () => { const r = hostRoom(); if (!r || (r.state !== 'question' && r.state !== 'reveal')) return; if (r.state === 'reveal') r.history.pop(); r.qi--; openNext(r); });
  on('host:restart', () => { const r = hostRoom(); if (!r) return; clearTimeout(r.timeout); const qs = buildQuestions(r.opts); if (qs.length) r.questions = qs;
    Object.assign(r, { state: 'lobby', qi: -1, votes: new Map(), history: [], reveal: null, paused: false, endsAt: 0 }); send(r); });
  on('host:end', () => { const r = hostRoom(); if (r && r.state !== 'lobby') { clearTimeout(r.timeout); r.paused = false; r.state = 'finished'; send(r); } });
  on('host:unclaim', d => {
    const r = hostRoom(); if (!r) return;
    const p = r.players.find(x => x.id === d.playerId); if (!p) return;
    if (p.socketId) { io.to(p.socketId).emit('kicked'); r.members.delete(p.socketId); }
    p.secret = null; p.socketId = null; r.votes.delete(p.id); send(r);
  });

  on('player:join', (d, ack) => {
    if (blocked(socket)) return ack(BLOCKED);
    const r = rooms.get(String(d.code || '').toUpperCase().trim());
    if (!r) { noteFail(socket); return ack({ error: 'Nincs ilyen szoba.' }); }
    ack({ players: r.players.map(p => ({ id: p.id, name: p.name, taken: !!p.secret })) });
  });
  on('player:claim', (d, ack) => {
    if (blocked(socket)) return ack(BLOCKED);
    const r = rooms.get(String(d.code || '').toUpperCase().trim()); if (!r) { noteFail(socket); return ack({ error: 'Nincs ilyen szoba.' }); }
    const p = r.players.find(x => x.id === d.playerId); if (!p) { noteFail(socket); return ack({ error: 'Ismeretlen név.' }); }
    if (p.secret && !same(p.secret, d.secret)) { noteFail(socket); return ack({ error: 'Ezt a nevet már valaki kiválasztotta.' }); }
    if (!p.secret) p.secret = rid(16);
    attach(socket, r, 'player', p.id); ack({ playerId: p.id, secret: p.secret }); send(r);
  });
  on('vote:submit', (d, ack) => {
    const r = room(); const m = r && r.members.get(socket.id);
    if (!r || !m || m.role !== 'player') return ack({ error: 'Nem vagy játékos.' });
    if (r.paused) return ack({ error: 'A játék szünetel.' });
    if (r.state !== 'question' || Date.now() > r.endsAt + GRACE) return ack({ error: 'Lezárult a szavazás.' });
    if (r.votes.has(m.playerId)) return ack({ error: 'Már szavaztál.' });
    const target = r.players.find(p => p.id === d.targetId);
    if (!target) return ack({ error: 'Ismeretlen név.' });
    if (!r.allowSelf && target.id === m.playerId) return ack({ error: 'Magadra nem szavazhatsz.' });
    r.votes.set(m.playerId, target.id); ack({ ok: true }); send(r); maybeEarly(r);
  });
  on('disconnect', () => {
    const r = room(); if (!r) return;
    r.members.delete(socket.id);
    const p = r.players.find(x => x.socketId === socket.id); if (p) p.socketId = null;
    send(r);
  });
});
setInterval(() => { for (const ip of failLog.keys()) if (!recent(ip).length) failLog.delete(ip); }, 60000);
setInterval(() => { for (const [c, r] of rooms) if (Date.now() - r.touched > 4 * 3600e3) { clearTimeout(r.timeout); rooms.delete(c); } }, 600e3);
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log('Fut: http://localhost:' + PORT));
