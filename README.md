# Ki lenne a legvalószínűbb? – bulijáték

## Helyi futtatás
    npm install
    npm start            # http://localhost:3000
    npm test             # (másik terminálban, futó szerver mellett) 27 automatikus ellenőrzés valódi socket-kliensekkel

## Több eszközön kipróbálás (ugyanazon a Wi-Fin)
1. Derítsd ki a gép IP-jét: Windows `ipconfig`, Mac `ipconfig getifaddr en0`, Linux `hostname -I` (pl. 192.168.1.20).
2. A host a gépén a `http://192.168.1.20:3000` címet nyissa meg (NE localhostot – a QR-kód ebből készül).
3. A telefonok olvassák be a QR-kódot, vagy a címre menve írják be a szobakódot.
4. Ha nem érik el: engedélyezd a 3000-es portot a tűzfalon.
Mobilneten lévő telefonokhoz: `npx localtunnel --port 3000` (vagy cloudflared) ad nyilvános https-címet.

## Nyilvános telepítés (nincs szükség API-kulcsra)
Render.com → New → Web Service → a repó → Build: `npm install`, Start: `npm start`, **egy** példány.
Fly.io / Railway ugyanígy. A `PORT` környezeti változót a szolgáltató adja.

## Kérdésbank szerkesztése (kódmódosítás nélkül)
A `questions/` mappa minden `.json` fájlja egy kategória:

    { "id": "chaos", "name": "Kaotikus viselkedés", "emoji": "🌪️",
      "questions": ["Ki …?", "Ki …?"] }

- **Új kérdés:** írd a `questions` listába egy új sorként. **Törlés:** töröld a sort.
- **Új kategória:** másolj egy meglévő fájlt (pl. `13-sport.json`), írj át benne mindent; az `id` legyen egyedi, a fájlnév sorrendje adja a kategóriák sorrendjét.
- A szerver minden játék létrehozásakor és az oldal megnyitásakor újraolvassa a fájlokat, **nem kell újraindítani**.
- Hibás JSON-fájlt a szerver kihagy és kiírja a konzolra. A duplikált sorokat automatikusan összevonja.
- A kizárás a kérdés szövegének lenyomatához kötött, így a kérdések átrendezése nem borítja fel.

## Vicces feliratok és hangok
- A győztes alatti vicces feliratok a `captions.json` fájlban vannak (`win` = egy győztes, `tie` = holtverseny, `none` = senki sem szavazott). Szabadon szerkeszthető, újraindítás nélkül.
- A hangeffektek a böngészőben szintetizálódnak (nincs hangfájl). A host gépén alapból be vannak kapcsolva, a telefonokon alapból némák; a jobb felső 🔊/🔇 gomb eszközönként átkapcsolja. A böngésző csak egy kattintás után enged hangot.

## Tesztek és telepítés
- `npm run check` – mindhárom tesztcsomag (szerver-szabályok, 9 játékosos QA-forgatókönyv, böngészős UI-teszt 6 telefonnal). Futó szerver kell hozzá (`npm start`).
- Telepítési útmutató kezdőknek: **DEPLOY.md**
