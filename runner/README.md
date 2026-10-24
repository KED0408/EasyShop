# EasyShop shop runner (Windows laptop)

The runner does the supermarket work for EasyShop: it finds your products at Tesco, Sainsbury's,
Morrisons and Ocado and checks this week's prices, in its own Microsoft Edge window that is signed
in as you. It starts when you sign in to Windows and picks up jobs you start from the app on your phone.

## One-off setup (about 15 minutes)

1. **Install Node.js.** Open *Command Prompt* and run:
   `winget install OpenJS.NodeJS.LTS`
   (or download the LTS installer from nodejs.org). Close and reopen Command Prompt afterwards.
2. **Download EasyShop.** On github.com/KED0408/EasyShop click **Code → Download ZIP**, then extract it to
   `C:\EasyShop` (so this file is at `C:\EasyShop\runner\README.md`).
3. **Install the runner:**
   ```
   cd C:\EasyShop\runner
   npm install
   ```
4. **Add the secret key.** Copy `.env.example` to `.env` (same folder), open it in Notepad and paste your
   Supabase secret key after `SUPABASE_SECRET_KEY=`. Supabase → Project Settings → API Keys → Secret keys.
   This key stays on this laptop only.
5. **Sign in to the stores:** `npm run setup` — an Edge window opens with a tab per store. Sign in on each
   (tick "remember me"), then close the window.
6. **Test it:** `npm start` — leave it running, open the app → **Prices** → it should say *Laptop online*.
   Press **Find products**. Stop the runner with Ctrl+C when you've seen it work.
7. **Start automatically:** `npm run install-startup` — from now on it starts minimised at sign-in.
   (`npm run remove-startup` undoes this.)

## Good to know
- The runner window opens minimised. You can watch it work, but don't close it while a job runs.
- If a store asks for a security check, the job reports it: open the runner window, complete the check,
  and press **Check prices** again.
- A first price check of ~50 items takes roughly 10–20 minutes (it searches every item at every store
  once); later checks reuse your approved products.
- Logs are in `runner.log` in this folder.
- To update after a new EasyShop release: download the ZIP again, extract over `C:\EasyShop`,
  then run `npm install` in `C:\EasyShop\runner` (your `.env` and sign-ins are kept).
