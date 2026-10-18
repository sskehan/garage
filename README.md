# Garage Log — standalone vehicle app

Runs on your phone with no Claude and no account. Vehicles, fuel, km, services, expenses and
receipt photos are stored on the phone itself. Nothing is uploaded anywhere.

## Files in this folder
index.html · app.js · sw.js · manifest.webmanifest · jszip.min.js · icon-192.png · icon-512.png · README.md

## 1. Put the app online (once, free) — GitHub Pages
Same steps as the Maglite app.
1. On github.com click **+** → **New repository**. Name it `garage`, choose **Public**, click **Create repository**.
2. Click **uploading an existing file**, drag in all the files from this folder (not the folder itself), **Commit changes**.
3. **Settings → Pages** → Source = **Deploy from a branch**, Branch = **main**, folder = **/ (root)** → **Save**.
4. After 1–2 minutes the app is at `https://sskehan.github.io/garage/`

Never upload a backup .zip to GitHub — the repository is public.

## 2. Install it on your Android phone
Open the address in **Chrome** → **⋮ → Add to Home screen / Install app**.
Long-press the icon for the **Log fuel** and **Log odometer** shortcuts.

## 3. Load your vehicles
Save `garage-starter-backup.zip` to the phone. In the app: **Restore backup…** → pick the file → **Restore**.
Loads the Kluger, Yaris, Triumph and Trailer with all service, cost and fuel history from the spreadsheet.

## Day to day
- **Fill-up:** tap the round **Log** button → type the odometer (or the trip km since the last fill), litres and total $. The $/L, km and L/100km are worked out. Untick **Filled to full** for a part fill, tick **Towing** when towing.
- **Km only:** Log → Odometer. Any record with an odometer reading feeds the km stats.
- **Service / expense:** Log → Service or Expense. Add photos of invoices. Logging Registration, CTP or Insurance offers to update the expiry date.
- **Due tab:** rego, CTP, insurance and service reminders (service km projected from your average driving).
- **Selling:** vehicle → **Reports** → Sale report → Print / PDF → Save as PDF. Then Edit → Status **Sold** to archive it with sale price and odometer.

## Electric vehicles (v2)
- **Add the Atto 1:** + Vehicle → *Start from a preset* → Essential or Premium. Fills in specs, warranty (6 yrs/150,000 km car, 8 yrs/160,000 km at 70% battery), 20,000 km/12-month servicing and the handbook's long-interval items. Add the plate, VIN, date bought, odometer when bought and warranty start date.
- **Home charging:** once a month, Log → Charge → Home: odometer and the month's kWh from the Evnex app. Cost fills in from your home rate (More → Settings).
- **Public charging:** Log → Charge → Public, from the receipt.
- **Battery health:** when you do the handbook's full charge from below 10% (every 3–6 months), tick that box and add start %, end % and the kWh for that session.
- **Parked:** tap *Parked from today* on the vehicle; storage reminders run from then and clear when you next log anything.

## Updating from v1
Make a backup first. Upload the changed files: `app.js`, `index.html`, `sw.js`, `manifest.webmanifest`, `README.md`. Your records are untouched; the Kluger's warranty and hybrid health check are added automatically the first time v2 opens.

## Backups — do this regularly
More → Backup & restore → **Make backup file** → Save to phone, or Share to Drive / email / your NAS.
Changing phones: install the app on the new phone, then Restore the latest backup.
Uninstalling the app or clearing Chrome's site data deletes the records on that phone — the backup file is the safety copy.

## If you change the app files later
Edit `sw.js` and change `const VERSION = "gl-v1"` to `"gl-v2"` (and so on), then upload. Your data is not affected.
