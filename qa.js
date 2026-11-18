// QA-tesztcsomag: valódi socket-kliensek (9 játékos + host), szinkron, időzítés, verseny, jogosultság, újracsatlakozás, vezérlők.
// Futtatás: npm start (egyik terminál), npm run qa (másik)
const { io } = require('socket.io-client');
const URL = process.env.URL || 'http://localhost:3000';
let fails = 0, passed = 0;
const ok = (c, m) => { c ? passed++ : fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const sec = t => console.log('\n■ ' + t);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const conn = (h) => new Promise(res => { const s = io(URL, { forceNew: true, transports: ['websocket'], extraHeaders: h }); s.log = []; s.on('state', st => { s.last = st; s.log.push({ t: performance.now(), st }); }); s.on('connect', () => res(s)); });
const ask = (s, e, d) => new Promise(r => s.emit(e, d, r));
const until = (s, f, ms = 12000) => new Promise((res, rej) => { const t0 = Date.now(); (function c() { if (s.last && f(s.last)) return res(s.last); if (Date.now() - t0 > ms) return rej(new Error('időtúllépés: ' + f)); setTimeout(c, 20); })(); });
const live = G => G.all.filter(s => s.connected);
const all = (G, f) => Promise.all(live(G).map(s => until(s, f)));
const qOpen = (G, qi) => all(G, x => x.state === 'question' && x.qi === qi);
const reveal = (G, qi) => all(G, x => x.state === 'reveal' && x.qi === qi);
const spread = (G, pred) => { const ts = live(G).map(s => (s.log.find(e => pred(e.st)) || {}).t); return ts.some(t => t === undefined) ? Infinity : Math.max(...ts) - Math.min(...ts); };
const same = (G, f) => new Set(live(G).map(s => JSON.stringify(f(s.last)))).size === 1;
async function player(code, name) {
  const s = await conn(); const j = await ask(s, 'player:join', { code }); const p = j.players.find(x => x.name === name);
  const c = await ask(s, 'player:claim', { code, playerId: p.id }); Object.assign(s, { pid: p.id, secret: c.secret, nm: name }); return s;
}
async function mkGame(names, joined, o = {}) {
  const host = await conn();
  const r = await ask(host, 'host:create', { names, timer: 5, count: 6, drama: false, sound: false, ...o });
  const G = { host, code: r.code, token: r.hostToken, P: [], all: [host] };
  for (const n of names.slice(0, joined)) { const s = await player(G.code, n); G.P.push(s); G.all.push(s); }
  await until(host, s => s.players.filter(p => p.claimed).length === joined);
  G.id = host.last.players.map(p => p.id); return G;
}
const NAMES = ['Anna', 'Bence', 'Csaba', 'Dóri', 'Edit', 'Feri', 'Gabi', 'Hanna', 'Ica'];

(async () => {
  /* ============ A: teljes játék, 8 + 1 késői játékos ============ */
  sec('A. Teljes játék: 8 játékos + 1 késői, holtverseny, verseny, lejárat, lecsatlakozás, frissítés');
  let G = await mkGame(NAMES, 8, { count: 6 }); const { id } = G; let host = G.host; const led = {}; id.forEach(i => led[i] = 0);
  const vote = async (s, ti) => { const r = await ask(s, 'vote:submit', { targetId: id[ti] }); if (r.ok) led[id[ti]]++; return r; };
  ok(/^[A-Z2-9]{4}$/.test(G.code) && G.P.length === 8, `szoba ${G.code}, 8 játékos bent`);
  host.emit('host:start', {}, () => {}); await qOpen(G, 0);
  let sp = spread(G, s => s.state === 'question' && s.qi === 0);
  ok(sp < 150, `1. kérdés mind a 9 eszközön egyszerre jelent meg (${sp.toFixed(0)} ms eltérés)`);
  ok(same(G, s => [s.q, s.endsAt, s.total]), 'minden eszköz ugyanazt a kérdést és határidőt kapta');
  ok(host.last.eligible === 8 && host.last.voted === 0, 'a host látja: 0/8 szavazott');
  await Promise.all(G.P.map((s, i) => vote(s, [0, 0, 0, 1, 1, 1, 2, 2][i]))); // 3–3–2
  await reveal(G, 0); const rv = host.last.reveal;
  ok(rv.tallies[id[0]] === 3 && rv.tallies[id[1]] === 3 && rv.tallies[id[2]] === 2 && rv.cast === 8, 'Q0 összesítés helyes (3–3–2)');
  ok(rv.winners.length === 2 && rv.winners.includes(id[0]) && rv.winners.includes(id[1]), 'holtverseny: mindkét 3 szavazatos közös győztes, senki sem lett önkényesen kiválasztva');
  ok(same(G, s => s.reveal), 'az eredmény minden eszközön azonos');
  ok(spread(G, s => s.state === 'reveal' && s.qi === 0) < 150, 'az eredmény egyszerre érkezett meg mindenhova');
  ok(host.last.players.length === 9 && rv.tallies[id[8]] === 0, 'a még be nem lépett 9. játékos is szerepel, 0 szavazattal');

  host.emit('host:next'); await qOpen(G, 1);
  const acc = {}; const tg = (i, k) => (i + k) % 8;
  await Promise.all(G.P.flatMap((s, i) => [0, 1, 2, 3, 4].map(k => vote(s, tg(i, k)).then(r => { if (r.ok) acc[s.pid] = (acc[s.pid] || 0) + 1; }))));
  ok(Object.keys(acc).length === 8 && Object.values(acc).every(n => n === 1), 'versenyhelyzet: 8×5 egyidejű szavazat → játékosonként pontosan 1 fogadva');
  await reveal(G, 1); ok(Object.values(host.last.reveal.tallies).reduce((a, b) => a + b, 0) === 8 && host.last.reveal.cast === 8, 'Q1 összesítés = 8 szavazat, duplikáció nélkül');

  host.emit('host:next'); await qOpen(G, 2); let t0 = performance.now(); await reveal(G, 2); let el = performance.now() - t0;
  ok(el > 4800 && el < 6500, `senki sem szavazott: a szerver lejáratkor lezárt (${el.toFixed(0)} ms)`);
  ok(host.last.reveal.winners.length === 0 && host.last.reveal.cast === 0 && typeof host.last.reveal.caption === 'string' || host.last.reveal.caption === null, 'üres eredmény kezelve (nincs győztes)');

  host.emit('host:next'); await qOpen(G, 3); const ea = host.last.endsAt;
  await sleep(ea - Date.now() - 300); ok((await vote(G.P[0], 4)).ok, 'szavazat a határidő előtt 300 ms-mal elfogadva');
  await reveal(G, 3); await sleep(150);
  ok(!!(await ask(G.P[1], 'vote:submit', { targetId: id[4] })).error, 'szavazat a határidő után elutasítva');
  ok(host.last.reveal.cast === 1, 'a késő szavazat nem került az eredménybe');
  const late = await player(G.code, 'Ica'); G.P.push(late); G.all.push(late);

  host.emit('host:next'); await qOpen(G, 4); const tOpen = Date.now(), [P5, P6] = [G.P[5], G.P[6]];
  ok((await vote(P6, 0)).ok, 'P6 szavazott, majd frissít (kapcsolat bontás)'); P6.close(); P5.close();
  await until(host, s => !s.players.find(p => p.id === P5.pid).online && !s.players.find(p => p.id === P6.pid).online); ok(true, 'a host látja, hogy ketten offline');
  const P6n = await conn(); const cl = await ask(P6n, 'player:claim', { code: G.code, playerId: P6.pid, secret: P6.secret }); Object.assign(P6n, { pid: P6.pid, secret: P6.secret });
  G.all[G.all.indexOf(P6)] = P6n; G.P[6] = P6n; await until(P6n, s => s.state === 'question' && s.qi === 4);
  ok(!cl.error && P6n.last.myVote === id[0] && P6n.last.endsAt === host.last.endsAt, 'frissítés után megmaradt a leadott szavazat és ugyanaz a határidő');
  ok(!!(await ask(P6n, 'vote:submit', { targetId: id[1] })).error, 'frissítés után sem lehet újra szavazni');
  for (const i of [0, 1, 2, 3, 4, 7, 8]) await vote(G.P[i], 3);
  await all(G, x => x.state === 'reveal' && x.qi === 4);
  ok(Date.now() - tOpen < 4500, `a lecsatlakozott játékos nem tartja fel a játékot (korai lezárás ${Date.now() - tOpen} ms)`);
  const P5n = await conn(); await ask(P5n, 'player:claim', { code: G.code, playerId: P5.pid, secret: P5.secret }); Object.assign(P5n, { pid: P5.pid, secret: P5.secret });
  G.all[G.all.indexOf(P5)] = P5n; G.P[5] = P5n; await until(P5n, s => s.state === 'reveal' && s.qi === 4);
  ok(JSON.stringify(P5n.last.reveal) === JSON.stringify(host.last.reveal) && host.last.reveal.cast === 8, 'visszatérő játékos ugyanazt az eredményt látja, késői játékos (Ica) szavazata is számít');

  host.emit('host:next'); await qOpen(G, 5); host.close(); await sleep(150); ok(!host.connected, 'a host kapcsolata megszakadt a kérdés közben');
  for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8]) await vote(G.P[i], 2);
  G.all = G.all.filter(s => s !== host); await reveal(G, 5);
  ok(true, 'host nélkül is lezárult és megjelent az eredmény a játékosoknál');
  const H2 = await conn(); const hr = await ask(H2, 'host:rejoin', { code: G.code, hostToken: G.token }); G.all.unshift(H2); G.host = host = H2;
  await until(H2, s => s.state === 'reveal' && s.qi === 5); ok(!hr.error && same(G, s => s.reveal), 'host frissítés után visszakapja az irányítást és ugyanazt az eredményt látja');
  H2.emit('host:next'); await all(G, x => x.state === 'finished');
  const aw = host.last.awards, sum = Object.values(aw.totals).reduce((a, b) => a + b, 0);
  ok(id.every(i => aw.totals[i] === led[i]), 'a végső szavazatszámok pontosan egyeznek a ténylegesen elfogadott szavazatokkal');
  ok(sum === Object.values(led).reduce((a, b) => a + b, 0) && sum === 8 + 8 + 0 + 1 + 8 + 9, `összes szavazat = ${sum} (8+8+0+1+8+9)`);
  ok(same(G, s => s.awards), 'a ranglista minden eszközön azonos');
  const top = Math.max(...Object.values(aw.totals));
  ok(id.filter(i => aw.titles[i].t === 'A társaság réme').every(i => aw.totals[i] === top) && id.some(i => aw.titles[i].t === 'A társaság réme'), 'a „társaság réme” cím a legtöbb szavazatot kapta');
  ok(id.every(i => (aw.totals[i] === 0) === (aw.titles[i].t === 'Az ártatlan')), 'az „ártatlan” cím pontosan a nulla szavazatúaké');
  G.all.forEach(s => s.close());

  /* ============ B: jogosultságok és biztonság ============ */
  sec('B. Jogosultságok, megszemélyesítés, hibás bemenet, kéréskorlát');
  G = await mkGame(NAMES.slice(0, 6), 6, { count: 3 }); host = G.host; G.host.emit('host:start', {}, () => {}); await qOpen(G, 0);
  const out = await conn(), snap = () => JSON.stringify([host.last.state, host.last.qi, host.last.round, host.last.paused, host.last.voted, host.last.players.map(p => p.claimed)]), before = snap();
  for (const s of [G.P[0], out]) { for (const ev of ['host:start', 'host:endVoting', 'host:skip', 'host:next', 'host:pause', 'host:resume', 'host:redo', 'host:restart', 'host:end']) s.emit(ev, {}); s.emit('host:unclaim', { playerId: G.P[1].pid }); s.emit('host:create', 5); }
  await sleep(400); ok(snap() === before, 'játékos és idegen NEM tud host-parancsot végrehajtani (10 parancs × 2 támadó)');
  const bad = await conn(); ok((await ask(bad, 'host:rejoin', { code: G.code, hostToken: 'nope' })).error && (await ask(bad, 'host:rejoin', { code: G.code, hostToken: {} })).error && (await ask(bad, 'host:rejoin', { code: G.code })).error, 'host-átvétel hamis/hiányzó tokennel elutasítva');
  ok((await ask(out, 'player:claim', { code: G.code, playerId: G.P[0].pid })).error && (await ask(out, 'player:claim', { code: G.code, playerId: G.P[0].pid, secret: G.P[1].secret })).error, 'másik játékos neve nem vehető át (nincs/hamis/más kulcs)');
  ok((await ask(out, 'vote:submit', { targetId: G.id[0] })).error, 'be nem lépett kliens nem szavazhat');
  ok((await ask(G.P[2], 'vote:submit', { targetId: G.id[0], playerId: G.P[3].pid, secret: G.P[3].secret, as: G.P[3].pid })).ok, 'hamis playerId/secret mezők figyelmen kívül maradnak');
  ok((await ask(G.P[3], 'vote:submit', { targetId: G.id[1] })).ok, '… így a megszemélyesíteni próbált játékos még szavazhat a saját nevében');
  for (const junk of [null, 5, 'x', [], { targetId: {} }, { targetId: [] }, { targetId: '__proto__' }, { targetId: 'constructor' }]) { await ask(G.P[4], 'vote:submit', junk).catch(() => {}); G.P[4].emit('player:claim', junk); G.P[4].emit('host:create', junk); G.P[4].emit('player:join', junk); }
  ok((await ask(out, 'time:sync', {})).now > 0, 'hibás/rosszindulatú üzenetek után a szerver él és válaszol');
  const big = await conn(); const closed = new Promise(r => big.on('disconnect', r)); big.emit('vote:submit', { x: 'A'.repeat(50000) }); await Promise.race([closed, sleep(1500)]); ok(!big.connected, 'túl nagy üzenet (50 KB) esetén a szerver bontja a kapcsolatot');
  const spam = await conn({ 'x-forwarded-for': '10.0.0.2' }); let errs = 0; await Promise.all(Array.from({ length: 200 }, () => ask(spam, 'player:join', { code: 'ZZZZ' }).then(r => { if (/lassíts/.test(r.error || '')) errs++; })));
  ok(errs > 50 && (await ask(await conn(), 'player:join', { code: G.code })).players, 'kéréskorlát: 200 gyors kérésből sok elutasítva, más kliens nem érintett');
  const ip = await conn(); let ipErr = 0; for (let i = 0; i < 90; i++) { const c = await conn({ 'x-forwarded-for': '10.0.0.3' }); const r = await ask(c, 'player:join', { code: 'NOPE' }); if (/Túl sok/.test(r.error || '')) ipErr++; c.close(); }
  ok(ipErr > 0 && !(await ask(await conn({ 'x-forwarded-for': '10.0.0.4' }), 'player:join', { code: G.code })).error, 'IP-alapú korlát: sok sikertelen találgatás letiltja az adott címet, mások nem érintettek'); ip.close();
  G.all.concat([out, bad, big, spam]).forEach(s => s.close());

  /* ============ C: host vezérlők ============ */
  sec('C. Host vezérlők: szünet, újra, kihagyás, korai vég, újrakezdés');
  G = await mkGame(NAMES.slice(0, 6), 6, { count: 6 }); host = G.host; const idc = G.id; const L = {}; idc.forEach(i => L[i] = 0);
  const v2 = async (s, ti) => { const r = await ask(s, 'vote:submit', { targetId: idc[ti] }); if (r.ok) L[idc[ti]]++; return r; };
  host.emit('host:start', {}, () => {}); await qOpen(G, 0); await sleep(1000); host.emit('host:pause'); await until(host, s => s.paused);
  ok(host.last.left > 3000 && host.last.left <= 4100, `szünet: a hátralévő idő rögzítve (${host.last.left} ms)`);
  ok(same(G, s => [s.paused, s.left]), 'a szünet minden eszközön azonnal látszik');
  ok((await ask(G.P[0], 'vote:submit', { targetId: idc[1] })).error, 'szünet alatt nem lehet szavazni');
  await sleep(5800); ok(host.last.state === 'question' && host.last.paused, 'az eredeti határidő elteltével is megáll a játék szünet alatt');
  host.emit('host:resume'); await until(host, s => !s.paused); const rem = host.last.endsAt - Date.now(); ok(rem > 2500 && rem < 4100, `folytatás: a maradék idő fut tovább (${rem} ms)`);
  await v2(G.P[0], 1); await reveal(G, 0); ok(host.last.reveal.cast === 1, 'folytatás után a határidőnél lezárt');
  host.emit('host:next'); await qOpen(G, 1); await v2(G.P[1], 2); await v2(G.P[2], 2); L[idc[2]] -= 2; const r0 = host.last.round;
  host.emit('host:redo'); await until(host, s => s.round > r0);
  ok(host.last.qi === 1 && host.last.voted === 0 && G.P[1].last.myVote === null, 'kérdés újraindítása: ugyanaz a kérdés, a korábbi szavazatok törölve');
  await v2(G.P[3], 3); host.emit('host:endVoting'); await reveal(G, 1); ok(host.last.reveal.cast === 1 && host.last.reveal.tallies[idc[3]] === 1, 'csak az újraszavazás számít');
  const r1 = host.last.round; host.emit('host:redo'); await until(host, s => s.round > r1 && s.state === 'question'); L[idc[3]]--;
  await v2(G.P[4], 4); host.emit('host:endVoting'); await reveal(G, 1);
  host.emit('host:next'); await qOpen(G, 2); host.emit('host:skip'); await qOpen(G, 3);
  ok(host.last.qi === 3, 'kihagyás: a következő kérdésre lép'); await v2(G.P[5], 0); L[idc[0]]--; // a félbehagyott kérdés szavazata nem számít
  host.emit('host:end'); await all(G, x => x.state === 'finished');
  const A2 = host.last.awards.totals; ok(idc.every(i => A2[i] === L[i]), 'korai befejezés: a ranglistában csak a lezárt kérdések szerepelnek, a kihagyott/újrajátszott nem duplázódik');
  host.emit('host:restart'); await all(G, x => x.state === 'lobby' && x.qi === -1);
  ok(host.last.players.every(p => p.claimed) && host.last.total === 6, 'újrakezdés: mindenki a lobbyban marad, új kérdéssor');
  host.emit('host:start', {}, () => {}); await qOpen(G, 0); host.emit('host:end'); await all(G, x => x.state === 'finished');
  ok(Object.values(host.last.awards.totals).every(n => n === 0), 'újrakezdés után a régi szavazatok nem maradtak meg');
  G.all.forEach(s => s.close());
  console.log(`\n${fails ? '✗ ' + fails + ' HIBA' : '✓ Minden ellenőrzés sikeres'} (${passed} sikeres, ${fails} hibás)`); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('✗ VÉGZETES: ' + e.message); process.exit(1); });
