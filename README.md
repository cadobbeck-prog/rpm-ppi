# RPM Services — PPI (Vehicle Inspection)

Mobile-first Pre-Purchase / safety inspection web app for **Casey Dobbeck / RPM Services**. Checklist lines come from the shop Excel form (`Sheet1`), with Pass / Fail / N/A, comments, photos, local save, JSON export, and a printable HTML report.

**Brand:** RPM Services (optional shop address field — not locked to the legacy Pleasanton address).

## Open on your phone today (no Pro / Cloud Agents)

### Option A — Static server on this machine (best)

From a terminal on the machine that has this folder:

```bash
cd /workspace/rpm-ppi
python3 -m http.server 8765
```

Then on your phone (same Wi‑Fi):

1. Find the computer’s LAN IP (e.g. `ip addr` / System Settings).
2. Open `http://<LAN-IP>:8765/` in Safari or Chrome.
3. Optional: **Add to Home Screen** for a PWA-style icon.

### Option B — Open the file directly

Copy the whole `rpm-ppi` folder to your phone (AirDrop, Files, Drive, USB) and open `index.html` in a browser.

- **iOS Safari:** file:// works for the UI; camera and IndexedDB usually work. Service worker may be limited.
- **Android Chrome:** prefer Option A if file:// is flaky.

### Option C — Laptop browser first

```bash
cd /workspace/rpm-ppi
python3 -m http.server 8765
# open http://127.0.0.1:8765/
```

Use Chrome/Edge **Device Mode** or print report from desktop.

## How to use at a PPI

1. Confirm the **demo header** or edit Year / Make / Model / VIN / mileage / client / tech / fee.
2. Capture **required photos**: odometer, VIN, four corners, engine, undercarriage, defects.
3. Walk sections with the **sticky nav**. Each line: **PASS / FAIL / N/A**, optional comment, optional photo (camera or gallery).
4. Items marked **★ SAFETY** (asterisk on the Excel form) are highlighted.
5. Toggle **Commercial / Upfit** for crane, compressor, service body doors, outriggers, PTO (on by default for the demo F‑550).
6. Tap **Save** often — data lives in **IndexedDB** on that browser (resume if you leave and come back).
7. **Export JSON** for backup / SafetyCulture import prep (`ITEMS.json` is the checklist schema).
8. **Print report** opens a branded HTML report with photos → browser **Print → Save as PDF**.
9. Capture **tech + customer signatures** and dates. Disclaimers match the Excel form only (no extra legal language invented).

## Demo job (prefilled)

| Field | Value |
|--------|--------|
| Vehicle | 2013 Ford F-550 Super Duty mechanic crane |
| Mileage IN | 86067 |
| Location | Vos Auto Hickman |
| Client | Battle Born Medivac / Brad Kitts |
| Tech | Casey Dobbeck |
| Date | 2026-09-16 |
| Fee | $650 |
| Shop | RPM Services |

Use **Reset demo job** to clear results and restore this header.

## Files

| File | Role |
|------|------|
| `index.html` | App shell |
| `styles.css` | Mobile-first UI |
| `app.js` | IndexedDB, photos, export, report |
| `items-data.js` | Embedded checklist (works offline / file://) |
| `ITEMS.json` | Same checklist, structured for SafetyCulture import |
| `manifest.json` / `sw.js` | Optional PWA install + offline cache |
| `icon-192.png` / `icon-512.png` | Icons |

## Counts

- **120** inspection lines from Excel Sheet1 (in order)
- **57** safety (asterisk) items
- **+5** commercial/upfit lines when enabled
- **9** required photo slots

## Notes

- Photos are JPEG-compressed data URLs stored with the inspection in IndexedDB — keep an eye on device storage on long jobs with many pictures.
- Clearing site data / using a different browser loses local saves; export JSON before that.
- Source form: `/workspace/rpm-ppi-shop-form.xlsx`.
