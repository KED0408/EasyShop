// Makes the runner start (minimised) every time you sign in to Windows.
// Run once:  npm run install-startup      Remove:  npm run remove-startup

import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const startup = path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
const file = path.join(startup, "EasyShop Runner.cmd");

if (process.argv.includes("--remove")) {
  if (fs.existsSync(file)) fs.unlinkSync(file);
  console.log("Removed. The runner will no longer start at sign-in.");
  process.exit(0);
}
if (!process.env.APPDATA || !fs.existsSync(startup)) {
  console.error("Couldn't find the Windows Startup folder — this step only works on Windows.");
  process.exit(1);
}
fs.writeFileSync(file, `@echo off\r\ncd /d "${here}"\r\nstart "EasyShop runner" /min cmd /c "node runner.mjs >> runner.log 2>&1"\r\n`);
// start it now too, so there is no need to restart Windows
spawn('start "EasyShop runner" /min cmd /c "node runner.mjs >> runner.log 2>&1"', { cwd: here, shell: true, detached: true, stdio: "ignore" }).unref();
console.log(`Done. The runner will start minimised whenever you sign in to Windows.\n(${file})`);
