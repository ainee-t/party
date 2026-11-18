// Tesztbotok: 5 játékos + host végigjátszik 3 kérdést. Futtatás: npm run bots (a szerver futása közben)
const { io } = require('socket.io-client');
const URL = process.env.URL || 'http://localhost:3000';
const names = ['Anna', 'Bence', 'Csaba', 'Dóri', 'Edit'];
const host = io(URL); let lastReveal = -1;
host.on('connect', () => host.emit('host:create', { names, timer: 5, count: 3, allowSelf: true }, async r => {
  const code = r.code; console.log('Szoba:', code);
  const bots = await Promise.all(names.map(n => new Promise(res => {
    const s = io(URL);
    s.on('connect', () => s.emit('player:join', { code }, j => {
      const p = j.players.find(x => x.name === n);
      s.emit('player:claim', { code, playerId: p.id }, () => res({ s, n }));
    }));
  })));
  bots.forEach(b => { b.last = -1; b.s.on('state', st => {
    if (st.state === 'question' && !st.myVote && b.last !== st.qi) {
      b.last = st.qi; const t = st.players[Math.floor(Math.random() * st.players.length)].id;
      b.s.emit('vote:submit', { targetId: t }, () => b.s.emit('vote:submit', { targetId: t }, y => console.log(b.n, 'második szavazat:', y.error)));
    } }); });
  host.on('state', st => {
    if (st.state === 'reveal' && lastReveal !== st.qi) { lastReveal = st.qi; console.log(st.q, JSON.stringify(st.reveal.tallies)); setTimeout(() => host.emit('host:next'), 300); }
    if (st.state === 'finished') { console.log('KÉSZ'); process.exit(0); }
  });
  host.emit('host:start', {}, a => a && a.error && console.log(a.error));
}));
