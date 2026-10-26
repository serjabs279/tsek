# Tsek — open exam checker

A local-first answer-sheet checker. Print sheets with each learner's name and
LRN, scan the stack as a PDF or photos, review flagged items, and export scores
as JSON for a gradebook.

Tsek is an open project. It was first built for San Roque Parish High School and
is not tied to that school: paper size, item count, choices, and the export file
names are all configurable.

Everything runs on the device: no uploads, no accounts. The workspace is saved on
the device and can be backed up as JSON from Settings.

Developed by **ZX TechLabs** · Developer: Richmond C. Jabla

## Run it

```bash
npm install
npm run dev      # http://localhost:5173 (browser)
npm run build    # production build into dist/
npm run preview  # serve the production build
```

## Desktop app

`src-tauri/` wraps the same build in a Tauri 2 shell. The webview is the UI;
the Rust side owns the files.

```bash
npm run desktop        # tauri dev against localhost:5173
npm run desktop:build  # release .exe + NSIS installer
```

Outputs land in `src-tauri/target/release/`: `tsek.exe` and
`bundle/nsis/Tsek_0.1.0_x64-setup.exe`.

What changes in the desktop build:

- The workspace is a real file, `workspace.json`, in the app data folder
  (`%APPDATA%\ph.zxtechlabs.tsek\`), with snapshots as individual files in
  `snapshots\`. Settings shows the exact path. A cache clear cannot wipe it, and
  the folder can be copied to another machine.
- Downloads go through a Windows save dialog, so sheet PDFs and result JSON land
  wherever you choose instead of inside the webview.
- A fresh install opens empty — no sample learners. **Explore the demo** on the
  home screen fills in a practice class if you want one.
- Browser data does not migrate by itself: use **Download workspace backup** in
  Settings on the web version, then **Restore from backup** in the desktop app.
- The app still runs fully offline. The installer needs WebView2, which is
  preinstalled on current Windows 10 and 11.
- Builds are unsigned, so SmartScreen shows "Windows protected your PC" on first
  launch until the binary is code-signed. Choose **More info → Run anyway**.

## How a class flows

1. **New exam** — pick Written Works, Performance Tasks, or Quarterly Exam, set
   20–100 items and 4–5 choices, choose a paper size (Folio, Legal, A4, Letter),
   orientation, and sheets per page, then pick the DepEd transmutation table
   (2015 or MATATAG 2027). The default is folio, landscape, two sheets per page.
   Describe the test structure as parts: multiple choice and true/false print
   bubbles and are scanned, while identification, enumeration, essay, and
   modified true/false are scored directly and added to the scanned total.
2. **Roster** — paste from Excel or import CSV. Each learner needs a name and LRN.
3. **Answer key** — click A–E per item, or paste a key string like `ABCDD…`.
4. **Sheets** — download one print-ready PDF for the class. Each sheet carries the
   learner's name, LRN, a QR code, and four black corner marks. With the default
   two-up layout, two portrait sheets sit side by side on a landscape folio page
   and are cut along the dashed center line; a portrait page stacks its two
   landscape sheets instead. Every paper size scales the same content.
5. **Scan** — drop the scanned PDF or page images. The scanner reads the QR to
   identify the learner, corrects perspective from the corner marks, and flags
   faint or double marks. A full two-up page is split into its two sheets; cut
   halves can be scanned one by one. Flagged sheets can be reviewed item by item.
6. **Export** — download:
   - `SRPHS_EXAM_SCORES` — category-aware assessment scores (recommended for
     the GradeApp, so WW/PT/QE weights apply correctly)
   - `SRPHS_TSEK_RESULTS` — full archive including every item answer and flag
   - a class results CSV
   - `SRPHS_SUBJECT_GRADES` — the legacy quarter-grade file, only when this one
     assessment really is the quarter grade

## Classroom tools

- **TOS planner** — builds the table of specifications from the part structure,
  so the printed sheet and the item distribution come from the same numbers.
- **Item analysis** — per-item correctness, distractor use, and flagged sheets,
  for scanned and hand-scored parts alike.
- **Snapshots** — the last seven workspace states are kept, and a destructive
  action (deleting an exam, learner, or result) saves one first, so a mistake is
  recoverable from Settings.

## Sheet geometry

`src/omr/layout.ts` is the single source of truth for print and scanning
coordinates (millimetres). It derives the sheet size from the page size,
orientation, and sheets per page, then scales the header, grid, and bubbles to
fit. If you change the layout, the printed sheets and the scanner stay in sync
automatically. Keep the QR clear of the top-right corner mark and the header
text clear of the top-left mark — the scanner uses the four marks to fit the
sheet.

## Scanner self-test

Settings → Scanner self-test (also on the Scan tab) renders the current sheet
shape clean, rotated, and photographed at an angle, then verifies the QR, corner
marks, and every answer. In two-up mode it also assembles a full page, checks
that both halves are split and read, and reports both results. Run it after
changing the layout or scanner.

## Notes

- Scans are held in memory only until the sheet is matched to an LRN.
- Editing the answer key or transmutation table recalculates saved scores.
- Changing item count clears scanned results for that exam.
- Changing paper, orientation, or sheets per page changes the printed geometry;
  reprint the sheets before scanning again. Stored scores are not affected.
- The workspace is currently persisted through a small storage adapter over
  `localStorage` (`srphs-tsek:v1`), so records can be replaced by a file-backed
  backend without touching the UI. Back up from Settings before clearing app
  data.
- Export file names keep the `SRPHS_` prefix (`SRPHS_EXAM_SCORES`,
  `SRPHS_TSEK_RESULTS`, `SRPHS_SUBJECT_GRADES`) because a receiving gradebook
  matches on those values. Rename them only together with the importer.
