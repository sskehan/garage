# MyGarage — vehicle records app (version 1.42)

Fuel, kilometres, charging, servicing, costs, warranty, reminders and sale reports for every vehicle.
Runs on your phone, works offline, and keeps a live backup in your own Dropbox.

App address: **https://sskehan.github.io/garage/**

## Files in this repository
index.html · app.js · sw.js · manifest.webmanifest · jszip.min.js · icon-192.png · icon-512.png · README.md

Only program files go here. The repository is public, so **never upload a backup file to GitHub.**

## 1. Install on your phone
1. Open the app address in **Chrome**.
2. Tap **⋮ → Install app** (or **Install and create shortcut → Install**).
3. Open **MyGarage** from your app list (long-press it → Add to Home to put it on the home screen).
4. Long-press the icon for the **Log fuel**, **Log charge** and **Log odometer** shortcuts.

## 2. Dropbox backup
### One-time: the Dropbox app (done — MyGarage, App key phvq3v06n9q3l18)
1. Go to **dropbox.com/developers/apps** → **Create app**.
2. Choose **Scoped access** → **App folder** → name it **MyGarage** → **Create app**.
3. **Permissions** tab: tick `files.metadata.read`, `files.content.read`, `files.content.write` → **Submit**.
4. **Settings** tab → **OAuth 2 → Redirect URIs**: add `https://sskehan.github.io/garage/` exactly → **Add**.
   Leave **Allow public clients (Implicit Grant & PKCE)** set to **Allow**.
5. Copy the **App key** (not the App secret — that is never used).

### Connect the app
**More → Backup & restore** → **Connect Dropbox** → sign in → **Allow**. (The App key `phvq3v06n9q3l18` is built in.)
If the sign-in comes back in a Chrome tab, you can close the tab and open MyGarage from the home screen.

- MyGarage can only see its own folder, **Dropbox › Apps › MyGarage**:
  - `live/mygarage.json` — the current copy, updated a few seconds after every change.
  - `live/files/` — photos and receipts, each sent once.
  - `snapshots/` — one full copy per day, plus one before every restore. Kept for 60 days.
- The line under **MyGarage** at the top shows the status: **in Dropbox ✓**, **2 changes waiting** (they go when you're online), or **not backed up**. Tap it to open Backup & restore.
- **Backup & restore** also has Sync now, Snapshot now, Restore a Dropbox snapshot, Only sync on Wi‑Fi, and Disconnect, plus the **backup file** option for an extra copy (e.g. on the QNAP).

## 3. Two phones
Install MyGarage on the second phone, tap **Get my vehicles from Dropbox**, and sign in with the **same Dropbox account**.

- Both phones can add and edit at the same time. On each sync the two copies are merged record by record:
  new records from both phones are kept, if both changed the same record the most recent change wins, and deletions carry across.
- Each change goes to Dropbox a few seconds after it's saved; the other phone picks it up when MyGarage is opened or brought back to the screen.
- A **restore** (from a file or a Dropbox snapshot) replaces the copy on both phones rather than merging — the copy it replaces is saved as a snapshot first.

## 4. Changing phones, or after clearing Chrome
1. Install the app (step 1).
2. Tap **Get my vehicles from Dropbox**, sign in, tap **Allow**. Everything comes back, including photos and receipts.

If you later open the app on the old phone, it merges with Dropbox like any second phone — nothing is overwritten.

When clearing Chrome's history, untick **Cookies and site data** — ticking it deletes the copy on the phone (Dropbox still has it).

## 5. Updating the app
1. Make sure the status line says **in Dropbox ✓**.
2. Upload the changed files to this repository (**Add file → Upload files → Commit changes**).
3. In the app: **More → Check for update** (tap twice if the version number doesn't change).

Your data is not affected. When a file changes, `APP_VERSION` at the top of `app.js` and `VERSION` in `sw.js` change together.

## Version history
- **1.42** — Fuel type is a proper dropdown when logging fuel and editing a vehicle.
- **1.41** — Two phones: records merged automatically; Dropbox App key built in.
- **1.4** — Dropbox live backup with daily snapshots and two-phone handling; renamed MyGarage.
- **1.3** — Reorder vehicles; dealer battery health checks; version number and Check for update.
- **v2** — Electric vehicles and charging, battery health, warranty, scheduled service items, parked mode, BYD Atto 1 presets.
- **v1** — Vehicles, fuel, odometer, service and expense records, reminders, stats, reports, backup file, CSV export.

The full user guide (PDF) covers everyday use: logging, reminders, stats, reports and settings.
