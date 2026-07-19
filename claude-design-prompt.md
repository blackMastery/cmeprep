# Prompt for Claude Design (v2 — updated with CME Prep brand)

Copy everything below the line into Claude Design.

---

Design a complete UI for **CME Prep (cmeprep.me)** — a question bank + timed mock exam web app for Guyana's Medical Board and Exit Examinations, built with Next.js, Tailwind, and shadcn/ui. Medical graduates and interns use it to practice MCQs and OSCEs by subject and topic, take timed mock tests, and track progress. Three roles: Trial (10 questions, 2 tests), Student (paid), Admin.

## Brand system (already established — follow exactly)
- **Palette:** deep crimson `#93273B` (primary, hover `#6E1B2B`), surgical teal `#2F7E74` (success/correct answers ONLY — used sparingly), ink `#22252E`, clinical off-white background `#FBFAF8`, card white `#FFFFFF`, blush tint `#F6ECEA` for tinted sections, border `#E7DFDA`.
- **Typography:** STIX Two Text (the typeface of medical journals) for display headings and question stems; Public Sans for body, UI, and labels. Question text is the hero — long-form readability is paramount.
- **Signature motif:** a thin ECG/heartbeat trace line used as section dividers and subtle accents (e.g., loading states, the timer under 5 minutes). Do not overuse it.
- **Feel:** focused, calm, confidence-building — "medical journal meets modern product," closer to Linear/Notion than Duolingo. Never pair red and green at large scale; teal appears only in small deliberate moments (correct answers, checkmarks, success states). Error/incorrect uses crimson paired with a cross icon so color-blind users can distinguish it from teal+check.
- Light mode primary, dark mode supported. Fully responsive; the test screen must work one-handed on a phone. Pill-shaped buttons: crimson filled = primary, crimson outline = secondary.

## Existing reference
The public marketing page is already designed in this system: sticky header, hero with a live sample MCQ card (question + teal-highlighted correct answer + explanation strip), ECG divider, stats row (1,000+ MCQs / 10 OSCEs / updated 2×/year), crimson "Who is CME Prep" band, 3-tier pricing ($0 trial, $144/1mo, $216/3mo with the featured card in solid crimson), reviews on blush, dark ink footer. Match this page's look; extend the system into the app.

## Screens to design (in priority order)

1. **Test-taking screen (most important).** One question at a time: stem in STIX Two Text (optionally with a clinical image), 4–6 answer options as large tap targets (radio for single-answer, checkbox for multi-correct with "select all that apply" hint), countdown timer that shifts to crimson + ECG pulse under 5 minutes, collapsible question palette (answered/unanswered/flagged), flag-for-review toggle, prev/next, submit flow with a dialog warning about unanswered questions, "saved just now" autosave indicator. Mobile + desktop variants.

2. **Results page.** Score as the hero number with %, time taken, per-topic accuracy as horizontal bars (crimson fills on blush tracks), CTAs: "Review wrong answers" (primary) and "Back to dashboard."

3. **Review mode.** Read-only test layout: user's selection marked, correct answer in teal with check, explanation panel below each question (styled like the marketing page's sample card), "wrong only" filter, bookmark + "add a note" actions per question.

4. **Student dashboard.** Greeting; stat cards (questions attempted, accuracy %, day streak); weak-areas list (lowest-accuracy topics); past tests table; prominent "Start new test"; account panel with Account Type and Trials Used (1/2) plus an upgrade prompt near the limit.

5. **New test wizard.** Subject → topics (multi-select chips) → question count, difficulty, duration → summary + start. 30 seconds max to complete.

6. **Question bank browser.** Sidebar subjects→topics tree; searchable, filterable (difficulty, type incl. OSCE, bookmarked) paginated list; detail view with "reveal answer & explanation," bookmark, personal notes. Trial-limit state: after 10 questions, remaining rows locked behind an upgrade card referencing the $144/$216 plans.

7. **Auth screens.** Login, register, forgot/reset password, verify-email interstitial. Centered card on off-white, small ECG rule under the logo.

8. **Admin: question editor.** Rich-text stem, image upload, type selector (MCQ single / multi / image-based / OSCE), dynamic option rows with correct toggles, difficulty, topic picker, explanation, publish/draft, live preview pane showing the student view.

9. **Admin: bulk upload.** Drag-and-drop CSV/XLSX/DOCX → validation-report table (row, error, severity) → "Import 195 valid rows" summary action.

10. **Admin: users table.** Search, role badges, active/banned status, row actions: change role, reset trials, ban, delete (destructive confirm in crimson).

## States to include
Empty states (no tests yet, no bookmarks), loading skeletons with a faint ECG shimmer, error state, trial-limit-reached upsell modal, timer-expired auto-submit screen.

## Deliverable
Start by formalizing the design system (tokens above + core components: buttons, answer option, stat card, timer, palette chip, plan card), then screens 1–4 as high-fidelity mockups in mobile and desktop widths. Use realistic Guyana medical-exam content: subjects like Medicine, Surgery, Obstetrics & Gynaecology, Paediatrics; clinical MCQs with plausible stems; scores like 68%.
