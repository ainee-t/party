// Automatikus többkliensű teszt: valódi socket-kapcsolatokkal ellenőrzi a szabályokat. Futtatás: npm start (egyik terminál), npm test (másik)
const { io } = require('socket.io-client');
const URL = process.env.URL || 'http://localhost:3000';
let fails = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const conn = () => new Promise(r => { const s = io(URL, { forceNew: true }); s.hist = []; s.on('state', st => { s.last = st; s.hist.push(st); }); s.on('connect', () => r(s)); });
const ask = (s, e, d) => new Promise(r => s.emit(e, d, r));
const until = (s, f, ms = 12000) => new Promise((res, rej) => { const t0 = Date.now(); (function chk() { if (s.last && f(s.last)) return res(s.last); if (Date.now() - t0 > ms) return rej(new Error('időtúllépés: ' + f)); setTimeout(chk, 25); })(); });
(async () => {
  const names = ['Anna', 'Bence', 'Csaba', 'Dóri', 'Edit'], P = {};
  const host = await conn();
  const r = await ask(host, 'host:create', { names, timer: 5, count: 3, allowSelf: true });
  const code = r.code; ok(/^[A-Z2-9]{4}$/.test(code), 'egyedi szobakód: ' + code);
  const ts = await ask(host, 'time:sync', {}); ok(Math.abs(ts.now - Date.now()) < 500, 'időszinkron végpont működik');
  const bank = await (await fetch(URL + '/api/questions')).json();
  ok(bank.length >= 12 && bank.every(c => c.items.length >= 20), `kérdésbank: ${bank.length} kategória, ${bank.reduce((a, c) => a + c.items.length, 0)} kérdés, mindegyikben ≥20`);
  const h2 = await conn(), c0 = bank[0];
  await ask(h2, 'host:create', { names: ['A', 'B'], timer: 5, count: 60, categories: [c0.id], exclude: [c0.items[0].id], custom: ['Saját teszt?'], shuffle: false });
  ok((await until(h2, s => s.total > 0)).total === c0.items.length, 'kategóriaválasztás + kizárás + saját kérdés: helyes kérdésszám'); h2.close();
  const h3 = await conn(); await ask(h3, 'host:create', { names: ['A', 'B'], categories: ['nincs-ilyen'], custom: [] });
  ok((await ask(h3, 'host:create', { names: ['A', 'B'], categories: ['nincs-ilyen'] })).error, 'üres kérdéskészlettel nem indítható szoba'); h3.close();
  async function join(n) { const s = await conn(); const j = await ask(s, 'player:join', { code }); const p = j.players.find(x => x.name === n);
    const c = await ask(s, 'player:claim', { code, playerId: p.id }); s.pid = p.id; s.secret = c.secret; P[n] = s; return s; }
  for (const n of names.slice(0, 4)) await join(n);
  await until(host, s => s.players.filter(p => p.claimed).length === 4); ok(true, '4 játékos megjelent a host lobbyjában');
  const A = P.Anna, B = P.Bence, C = P.Csaba, D = P.Dóri;

  const mal = await conn();
  ok(!!(await ask(mal, 'player:claim', { code, playerId: A.pid })).error, 'foglalt név titkos kulcs nélkül nem vehető át');
  ok(!!(await ask(mal, 'player:claim', { code, playerId: A.pid, secret: 'x'.repeat(32) })).error, 'hamis kulccsal sem');
  ok(!!(await ask(mal, 'vote:submit', { targetId: A.pid })).error, 'be nem lépett kliens nem szavazhat');
  mal.emit('host:start'); mal.emit('host:next'); mal.emit('host:end'); await sleep(250);
  ok(host.last.state === 'lobby', 'játékos nem tud host-parancsot küldeni');
  ok(!!(await ask(mal, 'host:rejoin', { code, hostToken: 'nope' })).error, 'host-átvétel hamis tokennel elutasítva');

  host.emit('host:start', {}, () => {});
  await Promise.all([host, A, B, C, D].map(s => until(s, x => x.state === 'question' && x.qi === 0)));
  ok(new Set([host, A, B, C, D].map(s => s.last.endsAt)).size === 1, '1. kérdés: ugyanaz a szerver-oldali endsAt minden eszközön');
  ok(!!(await ask(A, 'vote:submit', { targetId: 'zzz' })).error, 'érvénytelen név elutasítva');
  ok((await ask(A, 'vote:submit', { targetId: B.pid })).ok, 'szavazat elfogadva');
  ok(!!(await ask(A, 'vote:submit', { targetId: C.pid })).error, 'második szavazat elutasítva');
  await until(host, s => s.voted === 1); await until(C, s => s.voted === 1);
  ok(C.last.myVote === null && !JSON.stringify(C.last).includes('tallies') && !JSON.stringify(host.last).includes('tallies'), 'más szavazata nem látszik a felfedésig (csak darabszám)');
  await ask(B, 'vote:submit', { targetId: B.pid }); await ask(C, 'vote:submit', { targetId: A.pid }); await ask(D, 'vote:submit', { targetId: A.pid });
  await Promise.all([host, A, B, C, D].map(s => until(s, x => x.state === 'reveal' && x.qi === 0)));
  const rv = host.last.reveal;
  ok(rv.tallies[A.pid] === 2 && rv.tallies[B.pid] === 2 && rv.cast === 4 && rv.winners.length === 2, 'szerver számolta eredmény helyes (holtverseny 2–2)');
  ok([A, B, C, D].every(s => JSON.stringify(s.last.reveal) === JSON.stringify(rv)), 'az eredmény minden eszközön azonos');

  host.emit('host:next'); await until(host, s => s.state === 'question' && s.qi === 1); let t = Date.now();
  D.close(); await until(host, s => !s.players.find(p => p.id === D.pid).online); ok(true, 'lecsatlakozott játékos offline-nak látszik');
  const E = await join('Edit'); await until(E, s => s.state === 'question'); ok(true, 'késői csatlakozó (Edit) bekerült a futó játékba');
  ok((await ask(B, 'vote:submit', { targetId: A.pid, playerId: C.pid, secret: C.secret })).ok, 'B szavaz (hamis playerId-t is küld)');
  ok((await ask(C, 'vote:submit', { targetId: A.pid })).ok, 'C szavazata nem lett "elfoglalva" B hamis mezőitől – nincs megszemélyesítés');
  await ask(A, 'vote:submit', { targetId: E.pid }); await ask(E, 'vote:submit', { targetId: A.pid });
  await until(host, s => s.state === 'reveal' && s.qi === 1);
  ok(Date.now() - t < 4000, 'szavazás idő előtt lezárt, a lecsatlakozott játékos nem blokkol');
  ok(host.last.reveal.tallies[A.pid] === 3 && host.last.reveal.tallies[E.pid] === 1, 'a 2. kérdés eredménye helyes');

  host.emit('host:next'); await until(host, s => s.state === 'question' && s.qi === 2); t = Date.now();
  const D2 = await conn(); const c = await ask(D2, 'player:claim', { code, playerId: D.pid, secret: D.secret });
  await until(D2, s => s.state === 'question' && s.qi === 2);
  ok(!c.error && D2.last.myVote === null && D2.last.endsAt === host.last.endsAt, 'újracsatlakozás: titokkal visszakapja a helyét és a futó kérdést');
  const ea = host.last.endsAt; host.emit('host:pause'); await until(host, s => s.paused);
  ok(!!(await ask(A, 'vote:submit', { targetId: A.pid })).error, 'szünet alatt nem lehet szavazni');
  await sleep(1200); host.emit('host:resume'); await until(host, s => !s.paused);
  ok(host.last.endsAt - ea >= 1000, 'szünet után a határidő a kimaradt idővel tolódott');
  await ask(A, 'vote:submit', { targetId: A.pid });
  await until(host, s => s.state === 'reveal' && s.qi === 2); const el = Date.now() - t;
  ok(el > 4300 && el < 7500, `lejáró időzítő automatikusan lezárt (${el} ms)`);
  ok(!!(await ask(D2, 'vote:submit', { targetId: A.pid })).error, 'határidő utáni szavazat elutasítva');
  ok(host.last.reveal.cast === 1, 'a késői szavazat nem került be az eredménybe');

  ok(typeof host.last.reveal.caption === 'string' && host.last.reveal.caption.length > 0, 'vicces felirat érkezik az eredményhez');
  host.emit('host:next'); await until(host, s => s.state === 'finished');
  ok(Object.values(host.last.awards.totals).reduce((a, b) => a + b, 0) === 9, 'végső ranglista összege = 4+4+1 szavazat');
  const T = host.last.awards.titles;
  ok(T[A.pid].t === 'A társaság réme' && T[C.pid].t === 'Az ártatlan' && T[D.pid].t === 'Az ártatlan' && names.every((n, i) => T[[A, B, C, D, E][i].pid]), 'ranglista-címek: a legtöbb szavazat a „réme”, a nulla szavazatú az „ártatlan”');
  host.emit('host:restart'); await until(host, s => s.state === 'lobby' && s.qi === -1);
  ok(host.last.players.filter(p => p.claimed).length === 5 && host.last.total === 3, 'újrakezdés: lobby, a játékosok bent maradnak, új kérdéssor');
  host.emit('host:start', {}, () => {}); await until(host, s => s.state === 'question' && s.qi === 0); const rd = host.last.round;
  host.emit('host:redo'); await until(host, s => s.round > rd);
  ok(host.last.qi === 0 && host.last.voted === 0, 'kérdés újraindítása: ugyanaz a kérdés, nulláról');
  host.emit('host:end'); await until(host, s => s.state === 'finished');
  ok(Object.values(host.last.awards.totals).reduce((a, b) => a + b, 0) === 0, 'korai befejezés + újrakezdés után a régi szavazatok törölve');
  ok(host.hist.every(s => !('myVote' in s)), 'a host nézete sosem kap játékos-szavazatot');
  console.log(fails ? `\n${fails} HIBA` : '\nMinden teszt sikeres'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('✗ ' + e.message); process.exit(1); });
