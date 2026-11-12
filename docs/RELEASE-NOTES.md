# Tsek release notes

**Version 0.1.0** · 28 October 2026

Tsek is a local-first exam checker. You print answer sheets, scan the stack, and
get a clean record of every score. It runs on this device only — no accounts, no
uploads.

This release is the first complete build: the desktop app, the whole paper-to-JSON
workflow, and the classroom tools that grew out of it.

Companion material: [step-by-step tutorial with screenshots](tutorial/index.html)
(and [PDF](tutorial/Tsek-User-Guide.pdf)).

---

## Highlights

- **Three kinds of test in one workspace.** Multiple choice, true/false, and
  modified true/false print shaded bubbles and are read by the scanner.
  Identification, enumeration, and essay parts are typed in per learner. Both
  kinds add up to one combined score, one grade, and one analysis.
- **Score a written part per item or as a whole.** A part can give one score box
  for the entire handwritten answer (e.g. an essay out of 5) while all its items
  still count in the TOS and item analysis.
- **Item analysis with honest scopes.** Overall, MCQ-only, and non-MCQ-only views,
  each with its own reliability figure, distribution, thresholds, and a plain
  English recommendation for every item.
- **Reports you can hand in.** Every report downloads as a landscape PDF that
  uses the full page, and item analysis also exports CSV and a print layout.
- **A Windows desktop app** that keeps the workspace as a real JSON file, with
  automatic snapshots and a save dialog for every download.

---

## New in this build

### Test structure and whole-part scoring

- Setup describes the test as named parts. Each part has a type, item count,
  points per item, and a scanned or written marker.
- A written part can be scored **Each item** (one box per item) or **Whole part**
  (one box for the whole answer, out of the sum of its item points).
- The part summary and the "Ready to print?" checklist update from the same
  numbers, so the printed sheet, TOS, scores, and analysis cannot drift apart.
- Paper & printing settings (Folio, Legal, A4, Letter; portrait or landscape; one
  or two sheets per page; DO 8 s. 2015 or MATATAG 2027 transmutation) live beside
  the structure they affect.

### Written scores

- The Scores tab shows one column per written item, or one **whole part** column
  for pooled parts.
- Empty means *not yet scored*; `0` means *scored zero*. **Fill blanks with 0**
  handles a whole class in one click; **Clear written scores** starts over.
- Live totals: learners scored, complete sheets, class average, passing count,
  written / scanned / combined score per learner, and the transmuted grade.
- Written scores can be exported as CSV or PDF without leaving the tab.

### Item analysis

- **Overall** mixes scanned and written items, weighting each by its points.
- **MCQ** covers right/wrong items only and reports difficulty, discrimination,
  KR-20, KR-21, and Cronbach's alpha.
- **Non-MCQ** covers hand-scored items, uses partial-credit difficulty and
  corrected item-total correlation, and reports Cronbach's alpha.
- A scope with no items now explains why instead of showing a wall of zeros and
  dashes. The same empty-scope rule applies to PDF, print, and CSV, so an empty
  section is never exported as a fake table.
- Reliability, distribution, and recommendations are visibly separated: a figure
  that cannot be computed yet stays blank with the reason next to it.

### Recommendations

- Every item gets one of four verdicts — Accept, May Need Revision, Needs
  Revision, or Discard — computed from the same fixed rules and explained in one
  short paragraph using that item's own numbers.
- The per-item table shows max points, mean, median, range, how many were scored,
  percent earned, difficulty, discrimination, and the recommendation.
- The filter row (All / Accept / May Need Revision / Needs Revision / Discard)
  narrows the table without changing the aggregates above it.

### Exports and reports

- **GradeApp assessment scores** — category-aware WW / PT / QE file (recommended).
- **Tsek results archive** — full exam snapshot: roster, key, every item answer,
  flags, and summary. Restores a class inside Tsek.
- **Class results CSV** — one row per learner for spreadsheets.
- **Subject grades JSON** — legacy single-assessment quarter file, with an
  explicit warning because it treats one assessment as the whole quarter grade.
- **Workspace backup and restore** in Settings, plus the last seven snapshots
  kept automatically. Destructive actions save a snapshot first.

### Desktop app

- Tauri 2 shell for Windows. The workspace is `workspace.json` under
  `%APPDATA%\ph.zxtechlabs.tsek\`; snapshots are individual files beside it.
- Downloads open a Windows save dialog, so sheet PDFs and result files land
  where you choose.
- Build outputs: `src-tauri/target/release/tsek.exe` and the NSIS installer.

---

## Fixes

- **Empty analysis views.** A test with no written parts no longer shows an
  "Analyzed takers · 0 items · 0 pts" card wall. The view now says what is
  missing and offers the next action.
- **Empty scopes in CSV.** CSV export skips a scope with no items, matching the
  PDF and print reports.
- **Overlapping item analysis.** The per-item table no longer collides with the
  recommendation column.
- **Landscape PDFs.** Reports use the full landscape width instead of leaving the
  right half empty.
- **PDF export everywhere.** Every report tab has a working Download PDF action.

---

## Verification

- `npm test` — 7 automated checks for written, pooled, and empty non-MCQ scopes
  (totals, difficulty, reliability blanks, CSV scope handling).
- `npx tsc --noEmit` — clean.
- End-to-end pass on a 24-learner workspace with two exams:
  - MOCK — 18 items, 10 scanned, 8 written across two parts, 12 complete papers.
  - Mathematics — 65 items, 60 scanned, one pooled identification part, 10
    complete papers.
- Printed sheet PDFs rendered and checked page by page; the scanner self-test
  passes on clean, rotated, and angled pages, including a two-up sheet.

---

## Known limits

- **Handwriting is not read.** Identification, enumeration, and essay scores are
  typed in; the scanner only reads shaded bubbles.
- **Reliability needs enough rows.** KR-20/KR-21 need right/wrong items, and
  Cronbach's alpha needs at least two scored written rows. With one pooled part
  and one score per paper, alpha and discrimination stay blank — deliberately,
  with the reason shown.
- **Recommended item verdicts need both numbers.** If difficulty or
  discrimination cannot be computed for an item (for example, a pooled part with
  one row), that view says no verdict can be given rather than guessing.
- **Local data only.** There is no cloud sync. Back up from Settings, or copy the
  desktop workspace folder, before clearing app data or moving machines.
- **Reprint after geometry changes.** Changing paper size, orientation, or sheets
  per page changes the printed layout; reprint before scanning again. Changing
  the item count clears scanned results for that exam.
- **Unsigned Windows build.** SmartScreen shows "Windows protected your PC" on
  first launch; choose More info → Run anyway. Code signing is not set up.
- **Bubble density is finite.** The Setup screen warns when a page is getting
  crowded; roughly 65 scanned items is the comfortable maximum on a Folio page at
  the default two-up layout.

---

## Install and run

```bash
npm install
npm run dev        # browser at http://localhost:5173
npm run desktop    # Windows app against the dev server
npm run build      # production build into dist/
npm run desktop:build
```

The desktop installer needs WebView2, which is preinstalled on current Windows 10
and 11. Browser data does not migrate by itself: use **Download workspace
backup** in the browser Settings, then **Restore from backup** in the desktop app.

Tsek is an open project. It was first built for San Roque Parish High School and
is not tied to that school. SRPHS deployments carry AR Tech attribution; open
Tsek work carries ZX TechLabs. Developed by Richmond C. Jabla.
