# DROPZONE — Battle Royale Prototype

A browser-based battle royale built with Three.js and Vite.

---

## First Time Setup

Do this once when you first get the project.

**Step 1 — Install these two programs if you don't have them:**
- [Node.js](https://nodejs.org) — click the LTS download and run the installer
- [Git](https://git-scm.com/download/win) — run the installer with all default options

**Step 2 — Tell Git your name (only do this once ever):**

Open a terminal (search "cmd" or "PowerShell" in the Start menu) and run:
```bash
git config --global user.name "YourName"
git config --global user.email "your@email.com"
```
This just labels your commits so we know who made what change.

**Step 3 — Download the project:**
```bash
git clone https://github.com/mgarrett1515/dropzone.git
cd dropzone
npm install
npm run dev
```

After `npm run dev`, open the URL it shows in the terminal (usually `http://localhost:5173`) in your browser.

> After cloning, Git automatically remembers this repository. You never need to type the URL again — `git pull` and `git push` always go to this repo.

---

## Getting New Changes

Whenever your collaborator has pushed updates and you want them on your machine:

**1. Open a terminal inside the project folder.**
The easiest way is in VS Code — open the project, then press `Ctrl+`` (backtick) to open the built-in terminal. It automatically starts in the right folder.

Alternatively, open PowerShell and navigate there manually:
```bash
cd C:\path\to\dropzone
```

**2. Run:**
```bash
git pull
```

That's it — it fetches and applies everything new from the repository.

> Git commands only work when your terminal is inside the project folder (the one containing `package.json`). If you see `fatal: not a git repository`, you're in the wrong folder.

---

## Uploading Your Changes

After you've made edits and want to share them, make sure your terminal is in the project folder (see above), then run:

```bash
git add .
git commit -m "describe what you changed here"
git push
```

- `git add .` — stages all your changed files
- `git commit -m "..."` — saves a snapshot with a label (replace the message with something descriptive, like `"added new gun"`)
- `git push` — sends it up to GitHub so your collaborator can pull it

---

## Controls

| Key | Action |
|-----|--------|
| WASD | Move |
| Shift | Sprint |
| Space | Jump |
| C | Crouch (toggle) |
| Q / E | Lean left / right |
| V | Toggle camera (first/third person) |
| X | Swap shoulder |
| LMB | Shoot |
| RMB | Aim |
| R | Reload |
| F | Loot |
| H | Heal |
| 1 / 2 / 3 | Switch weapons |
| Tab | Inventory |
| M | Minimap |
| Esc | Pause |