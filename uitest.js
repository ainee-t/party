// Böngészős (jsdom) végpontok közti teszt: a valódi index.html + kliens-kód fut 1 host + 6 játékos ablakban, gombnyomásokkal.
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const BASE = process.env.URL || 'http://localhost:3000';
let fails = 0, passed = 0; const errors = [];
const ok = (c, m) => { c ? passed++ : fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
class RL extends ResourceLoader { fetch(u, o) { return u.startsWith(BASE) ? super.fetch(u, o) : Promise.resolve(Buffer.from('')); } } // külső CDN (QR) kihagyva
async function open(store) {
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(e.message)); vc.on('error', e => errors.push(String(e)));
  const dom = await JSDOM.fromURL(BASE, { runScripts: 'dangerously', resources: new RL(), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.matchMedia = () => ({ matches: false }); w.navigator.vibrate = () => {}; w.alerts = []; w.alert = m => w.alerts.push(m); w.confirm = () => true;
      w.fetch = (u, o) => fetch(new URL(u, BASE), o); if (store) w.localStorage.setItem('wwml', store); } });
  const w = dom.window; for (let i = 0; i < 150; i++) { try { if (w.eval("typeof go === 'function' && typeof io === 'function'")) break; } catch (e) {} await sleep(40); }
  w.$$ = s => [...w.document.querySelectorAll(s)]; w.txt = () => w.document.querySelector('#app').textContent.replace(/\s+/g, ' '); // csak a megjelenített tartalom (a <script> forrása nem számít)
  w.btn = t => w.$$('button').find(b => b.textContent.includes(t)); return w;
}
const waitFor = async (f, m, ms = 9000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (f()) return true; } catch (e) {} await sleep(40); } ok(false, 'IDŐTÚLLÉPÉS: ' + m); throw new Error(m); };
const NAMES = ['Anna', 'Bence', 'Csaba', 'Dóri', '<u onclick=_>x</u>', 'Feri'];
(async () => {
  console.log('\n■ UI. Host + 6 játékos valódi kliens-kóddal');
  const H = await open(); H.eval("go('setup')"); await waitFor(() => H.$$('#nm')[0], 'beállító képernyő');
  for (const n of NAMES) H.eval(`$('#nm').value=${JSON.stringify(n)};addName()`);
  H.eval("cfg.timer=10;cfg.count=10;render()"); await waitFor(() => H.$$('#mk')[0] && !H.$$('#mk')[0].disabled, 'létrehozás gomb aktív'); 
  ok(/10 kérdés lesz a játékban/.test(H.txt()), 'a beállító összegzi a kérdések számát');
  H.$$('#mk')[0].click(); await waitFor(() => H.$$('.tile').length === 4, 'szobakód megjelenik');
  const code = H.$$('.tile').map(t => t.textContent).join(''); ok(/^[A-Z2-9]{4}$/.test(code), 'host lobby: szobakód ' + code);
  ok(!H.document.querySelector('u') && H.txt().includes('<u onclick=_>x</u>'), 'XSS: a kártevő név szövegként jelenik meg, nem fut le');
  const Ps = [];
  for (const n of NAMES) {
    const w = await open(); w.eval("go('join')"); await waitFor(() => w.$$('#code')[0], 'csatlakozó képernyő'); w.$$('#code')[0].value = code.toLowerCase(); w.btn('Belépek').click();
    await waitFor(() => w.$$('.pv').length === 6, 'névválasztó (6 név)'); w.$$('.pv').find(b => b.textContent.includes(n)).click(); await waitFor(() => w.txt().includes('Bent vagy'), n + ' belépett'); Ps.push(w);
  }
  await waitFor(() => H.$$('.chip').filter(c => !c.classList.contains('off')).length === 6, 'a host lobbyjában mind a 6 név aktív');
  ok(Ps.every(w => w.$$('.pv').length === 0 && w.$$('.chip').length === 6), 'minden telefon látja (saját + 5 másik név) a másik 5 játékost a lobbyban'); ok(!Ps[4].document.querySelector('u'), 'XSS: a telefonon sem fut le');
  ok(!!(await (async () => { Ps[0].$$('#code')[0]; const w = await open(); w.eval("go('join')"); await waitFor(() => w.$$('#code')[0], 'x'); w.$$('#code')[0].value = code; w.btn('Belépek').click(); await waitFor(() => w.$$('.pv').length === 6, 'x');
    ok(w.$$('.pv').filter(b => b.disabled).length === 6, 'a már foglalt nevek letiltva az újonnan érkezőnél'); w.close(); return true; })()), 'késői érdeklődő ellenőrizve');
  H.btn('Indulhat').click(); await waitFor(() => Ps.every(w => w.$$('.qcard')[0]) && H.$$('.qcard')[0], 'a kérdés mindenhol megjelent');
  const qt = H.$$('.qcard')[0].textContent; ok(Ps.every(w => w.$$('.qcard')[0].textContent === qt), 'mind a 6 telefon és a host ugyanazt a kérdést mutatja: „' + qt.slice(0, 40) + '…”');
  ok(H.$$('#t')[0] && Ps.every(w => w.$$('#t')[0] && Math.abs(+w.$$('#t')[0].textContent - +H.$$('#t')[0].textContent) <= 1), 'a visszaszámláló mindenhol ugyanazt az értéket mutatja (±1 mp)');
  /* Q1: 2–2–1–1 → holtverseny; szavazás gombnyomással */
  const plan = [0, 0, 1, 1, 2, 3];
  for (let i = 0; i < 6; i++) { Ps[i].$$('.pv')[plan[i]].click(); await waitFor(() => Ps[i].txt().includes('Szavazat rögzítve'), NAMES[i] + ' szavazata rögzítve'); }
  ok(Ps.every((w, i) => w.txt().includes('Erre szavaztál:')), 'minden játékos „rögzítve” állapotot lát'); 
  await waitFor(() => H.$$('.hero')[0] && Ps.every(w => w.$$('.hero')[0]), 'eredmény megjelent mindenhol (korai lezárás)');
  ok(H.$$('.jw').length === 2 && Ps.every(w => w.$$('.jw').length === 2), 'holtverseny: 2 közös győztes minden eszközön'); ok(/HOLTVERSENY/.test(H.txt()) && H.$$('.cap')[0], 'holtverseny felirat + vicces megjegyzés látszik');
  const rows = h => h.$$('.res .track em').map(e => e.textContent).join('|'); ok(rows(H) === rows(Ps[0]) && H.$$('.res').length === 6 && /33%/.test(rows(H)) && /17%/.test(rows(H)), 'darabszám és százalék minden eszközön azonos: ' + rows(H));
  ok(Ps.every(w => w.$$('.pv').length === 0), 'eredménynél a szavazógombok eltűntek');
  /* pause a következő kérdésnél, majd egy játékos „frissít” */
  H.btn('Következő').click(); await waitFor(() => Ps.every(w => w.$$('.pv').length === 6), '2. kérdés mindenhol');
  Ps[2].$$('.pv')[1].click(); await waitFor(() => Ps[2].txt().includes('Szavazat rögzítve'), 'szavazat');
  H.btn('Szünet').click(); await waitFor(() => Ps.every(w => w.txt().includes('Szünet')), 'a szünet minden telefonon látszik'); ok(/SZÜNET/.test(H.txt()), 'a host képernyőjén is SZÜNET felirat');
  const store = Ps[2].localStorage.getItem('wwml'); Ps[2].close(); const R = await open(store); await waitFor(() => R.txt().includes('Szünet'), 'frissítés közben a szünet állapot visszaáll'); 
  H.btn('Folytatás').click(); await waitFor(() => R.txt().includes('Szavazat rögzítve'), 'frissítés után a leadott szavazat látszik'); Ps[2] = R;
  ok(R.$$('.pv').length === 0 && /Erre szavaztál/.test(R.txt()), 'a frissített oldal a „szavazat rögzítve” képernyőt mutatja, nem engedi újra szavazni');
  for (const i of [0, 1, 3, 4, 5]) { await waitFor(() => Ps[i].$$('.pv').length === 6, 'a szünet után visszatért a szavazófelület ' + i); Ps[i].$$('.pv')[2].click(); await waitFor(() => Ps[i].txt().includes('Szavazat rögzítve'), 'szavazat ' + i); }
  try { await waitFor(() => H.$$('.hero')[0], '2. eredmény'); } catch (e) { console.log('DEBUG host:', H.txt().slice(0, 260)); console.log('DEBUG errs:', errors.slice(-3)); console.log('DEBUG players:', Ps.map(w => w.txt().slice(0, 70))); throw e; } ok(/(\d+) szavazat · 83%/.test(H.txt()) || /\d+%/.test(H.txt()), 'a 2. kérdés eredménye százalékokkal megjelent');
  /* Befejezés → ranglista */
  H.eval("emit('host:end')"); await waitFor(() => H.$$('.lr').length === 6 && Ps.every(w => w.$$('.lr').length === 6), 'ranglista mindenhol (6 sor)');
  const lb = h => h.$$('.lr').map(r => r.textContent.replace(/\s+/g, ' ')).join('|'); ok(lb(H) === lb(Ps[0]) && lb(H) === lb(Ps[5]), 'a ranglista minden eszközön azonos');
  const pcts = H.$$('.lr .vv small').map(e => parseInt(e.textContent)); ok(Math.abs(pcts.reduce((a, b) => a + b, 0) - 100) <= 3, 'a százalékok összege ~100%: ' + pcts.join('+'));
  ok(H.$$('.lr .ttl').every(e => e.textContent.trim().length > 2) && /ártatlan|réme|katasztrófa|vörös|keresett|Főszereplő|gyanúsított/.test(H.txt()), 'minden játékos kapott címet'); ok(H.$$('.pod .blk').length === 3, 'dobogó 3 hellyel');
  const ranks = H.$$('.lr .rk').map(e => parseInt(e.textContent.slice(1))), tv = H.$$('.lr .vv b').map(e => +e.textContent);
  ok(ranks.every((r, i) => r === 1 + tv.filter(x => x > tv[i]).length) && tv.every((v, i) => i === 0 || tv[i - 1] >= v), 'a helyezések helyesek (azonos szavazatszám = azonos hely, csökkenő sorrend)');
  [H, ...Ps].forEach(w => w.close());
  const real = errors.filter(e => !/Could not load script|Not implemented|navigation/i.test(e)); ok(real.length === 0, 'nincs JavaScript-hiba egyik ablakban sem' + (real.length ? ': ' + real.slice(0, 3).join(' / ') : ''));
  console.log(`\n${fails ? '✗ ' + fails + ' HIBA' : '✓ Minden UI-ellenőrzés sikeres'} (${passed} sikeres, ${fails} hibás)`); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('✗ VÉGZETES: ' + e.message); process.exit(1); });
