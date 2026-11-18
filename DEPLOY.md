# Deployment guide (beginner friendly)

You will put the game on the internet for free, get a link, and send it to your friends.
No coding needed. Total time: about 15 minutes. Cost: 0 Ft.

You need: a computer, a free **GitHub** account (github.com) and a free **Render** account (render.com).
The game is one program that serves the web page *and* handles the live multiplayer. There is **no database, no API key and no separate backend to connect.**

---
## 1. Put the code on GitHub
1. Unzip `ki-lenne-a-legvalószínűbb.zip`. You get a folder `party` containing `server.js`, `package.json`, a `public` folder, a `questions` folder, etc.
2. On github.com click **+ → New repository**. Name it e.g. `party-game`. Keep it **Private** if you like. Click **Create repository**.
3. On the empty repository page click **uploading an existing file**.
4. Open the unzipped `party` folder and drag **everything inside it** (not the folder itself) into the browser window. `package.json` must end up at the top level of the repository, not inside another folder.
5. Click **Commit changes**.

## 2. Deploy on Render
1. On render.com sign in with your GitHub account (**Sign in with GitHub**).
2. Click **New + → Web Service**, choose **Build and deploy from a Git repository**, and select your `party-game` repository (Render asks permission to see it the first time).
3. Fill in:
   - **Language / Runtime:** Node
   - **Build Command:** `npm install --omit=dev`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Click **Deploy Web Service**. Wait 2–3 minutes until the log says the service is **Live**.
   (Shortcut: **New + → Blueprint** also works, because the repository contains a `render.yaml` with these same settings.)

## 3. Connect the backend and get your shareable URL
- Nothing to connect: the web page automatically talks to the server it was loaded from.
- Your link is shown at the top of the service page, like `https://party-game-xxxx.onrender.com`. That is the **shareable URL**.
- Test it: open it on your phone **with Wi-Fi turned off** (mobile data). If you see the home screen, it works from anywhere.
- Keep the URL in your phone notes. Open `https://…onrender.com/healthz`: it should say `ok`.

## 4. How friends join (no accounts, nothing to install)
1. Friends open your link, or scan the **QR code** on the host screen. The QR code fills in the room code automatically.
2. If they open the plain link, they type the 4-letter room code shown on the big screen and tap **Belépek!**.
3. They tap **their own name** in the list. That's all. Taken names turn grey ("foglalt").
- If a phone refreshes, locks, or loses signal, it comes back to the same name and the same question automatically.
- Picked the wrong name? On the host screen (lobby) tap the **✕** next to that name; the name becomes free again.
- Message you can copy to the group chat: *„Buli-játék ma estére! Nyisd meg: https://IDE-A-LINKED – a kódot a nagy képernyőn látod, utána koppints a saját nevedre. Nem kell regisztráció.”*

## 5. On the day of the outing
**30 minutes before**
1. Free Render services go to sleep after ~15 minutes without traffic and need about **1 minute** to wake up. Open your link on the host device now so it is awake and warm.
2. Connect the laptop to the TV (HDMI, or cast the browser tab). Open your link and tap **Új játék indítása**.
3. Type everyone's name (include people who may arrive late). Pick categories, timer (15 s is good), number of questions (15–20), and switch **Drámai felfedés** and **Hangeffektek** on or off. Tap **Szoba létrehozása**.
4. Click once anywhere on the page, then check the 🔊 button (browsers only allow sound after a click). Phones are muted by default so twelve phones don't beep at once.
5. Send the link to friends. Watch the lobby: names light up as people join.

**Running the game** (buttons are on the host screen)
- **Indulhat!** starts. Each question closes when the timer ends, or earlier when everyone connected has voted.
- **Szavazás lezárása**: close voting early. **⏸️ Szünet / ▶️ Folytatás**: pause the clock (e.g. while the waiter arrives). **🔁 Kérdés újra**: ask the same question again. **⏭️ Kihagyás**: skip a question you don't like.
- **Következő kérdés**: after the results. **🏁 Befejezés**: jump to the final leaderboard. **🔄 Újrakezdés**: back to the lobby with the same people and fresh questions.
- Keep the host tab open. If you refresh it, you automatically get control back.

**If something goes wrong**
| Problem | What to do |
|---|---|
| Link takes a minute to load | The free server was asleep. Wait; it only happens once. |
| A friend can't connect | Ask them to reload the page and re-enter the code. Check they typed the code, not the name of the site. |
| Someone grabbed the wrong name | Lobby → ✕ next to the name. |
| Page says the game no longer exists | Render restarted the free server (rare). Create a new room and send the new code. |
| Internet at the venue is bad | Backup plan below. |

**Backup plan (no internet service needed, everyone on the same Wi-Fi/hotspot)**
Install Node.js (nodejs.org) on the host laptop, open a terminal in the `party` folder and run `npm install` then `npm start`. Find the laptop's IP (Windows: `ipconfig`; Mac: `ipconfig getifaddr en0`), open `http://THAT-IP:3000` on the laptop (not `localhost`, so the QR code works) and let friends join on the same network. For friends on mobile data, install *cloudflared* and run `cloudflared tunnel --url http://localhost:3000` to get a temporary public https link.

## Editing questions later
On GitHub open the `questions` folder, click a file, press the pencil ✏️ and edit. Funny winner captions are in `captions.json`. Commit; Render redeploys by itself in a couple of minutes. You can also test edits locally; no restart is needed there.

## Good to know
- Free tier: 750 hours/month (enough for one service), sleeps when idle, and Render may restart it at any time. Games live in memory, so a restart ends the current game. Everything else (questions, code) is safe on GitHub.
- Only the browser that created the room can control it. Friends cannot take over the host role.
- Games are deleted from memory after 4 hours of inactivity.
