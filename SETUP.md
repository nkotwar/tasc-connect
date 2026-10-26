# TASC Connect: setup

About 30 minutes, once. Everything here is free. You need a computer for steps 1–5; after that, everything is on the phone.

What goes where:

| Piece | Where | Holds |
|---|---|---|
| The app | GitHub Pages (public repo `tasc-connect`) | Code only. **No staff data, ever.** |
| Data, sign-in, photos | Supabase (Mumbai) | Staff list, places, visits, photos |
| "Sign in with Google" | Google Cloud project **TASC Connect** (new, separate from Hazri) | Nothing, it only proves the Gmail |

Hazri is not touched: TASC Connect uses no Firebase, a different Google Cloud project and a different repo.

You have two SQL files:

- `sql/01_schema.sql`: the database structure. It is in the repo and contains no data.
- `02_seed_PRIVATE.sql`: staff (with dates of birth), the 338 places and their allotments. **Keep it private.** Don't upload it to GitHub, don't forward it. Delete it after step 2.

---

## 1. Create the Supabase project

1. Go to **supabase.com** → **Start your project** → sign in (GitHub or Google is fine).
2. If asked, create an organization: any name, plan **Free**.
3. **New project**:
   - Name: `daura`
   - Database password: click **Generate a password** and save it somewhere safe (you rarely need it).
   - Region: **South Asia (Mumbai)**
   - Click **Create new project** and wait about 2 minutes.

## 2. Load the database

1. Left menu → **SQL Editor** → **New query**.
2. Open `sql/01_schema.sql`, copy everything, paste it in, click **Run**.
   - The result shows one empty column, `table_without_rls`. **Empty is correct**: it means every table is protected.
3. **New query** again. Open `02_seed_PRIVATE.sql`, copy everything, paste, **Run**.
   - The last result shows **160 staff · 338 places · 338 assigned visits**.
   - This step also makes **nkotwar@gmail.com** the admin, linked to Emp ID 139535.
4. Delete `02_seed_PRIVATE.sql` from your computer and Downloads.

Both files are safe to run again if something stops halfway.

## 3. Create the Google sign-in (new project, not Hazri's)

1. Go to **console.cloud.google.com**. In the project picker at the top, choose **New project**, name it `TASC Connect`, then **Create**. Make sure **TASC Connect** is selected at the top before going on.
2. Search for **Google Auth Platform** and open it → **Get started**:
   - App name: `TASC Connect`. User support email: your Gmail.
   - Audience: **External**.
   - Contact email: your Gmail. Agree, then **Create**.
3. **Audience** (left menu) → **Publish app** → **Confirm**. The status becomes **In production**.
   - TASC Connect only asks for name and email, so Google needs no review, there's no 100-user limit, and no weekly re-login.
4. **Clients** (left menu) → **Create client**:
   - Application type: **Web application**. Name: `TASC Connect web`.
   - **Authorised JavaScript origins** → **Add URI** → enter exactly `https://nkotwar.github.io` (no `/tasc-connect`, no slash at the end).
   - Leave **Authorised redirect URIs** empty → **Create**.
5. Copy both the **Client ID** (ends in `.apps.googleusercontent.com`) and the **Client secret**.

## 4. Connect Google to Supabase, and turn off other sign-ins

In Supabase:

1. **Authentication → Sign In / Providers**.
2. **Google** → turn on **Enable Sign in with Google**:
   - **Client IDs**: paste the Client ID.
   - **Client Secret**: paste the secret.
   - Leave **Skip nonce checks** off → **Save**.
3. **Email** → turn **Enable Email provider** **off** → **Save**. TASC Connect must only accept Google sign-in; that is part of how it knows who is who.
4. On the same page, check that **Allow new users to sign up** is **on**. Staff are created the first time they sign in with Google.
5. Copy two things:
   - **Project URL**: Project Settings → **Data API** (looks like `https://abcd1234.supabase.co`).
   - **Publishable key**: Project Settings → **API Keys** (starts with `sb_publishable_`). Never use the *secret* key anywhere.

Now open `config.js` and fill in the three values:

```js
const DAURA_CONFIG = {
  supabaseUrl: 'https://abcd1234.supabase.co',
  supabaseKey: 'sb_publishable_xxxxxxxx',
  googleClientId: '1234-abc.apps.googleusercontent.com'
};
```

These three are meant to be public. What protects the data is the database's access rules.

## 5. Put the app on GitHub Pages

1. On github.com, click **+ → New repository**. Name it `tasc-connect`, set it to **Public** → **Create repository**.
2. Click **uploading an existing file** and drag in everything from the TASC Connect folder **except** the private SQL file:
   - `index.html`, `styles.css`, `config.js` (filled in), `version.js`
   - `core.js`, `auth.js`, `visits.js`, `profile.js`, `admin.js`, `main.js`, `sw.js`
   - `manifest.webmanifest`, `icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-192.png`, `icon-maskable-512.png`, `cbi-emblem.png`
   - `privacy.html`
   - the `sql` folder (only `01_schema.sql` is in it), `README.md`, `SETUP.md`, `.gitignore`
   - Then **Commit changes**.
3. **Settings → Pages**: Source **Deploy from a branch**, Branch **main**, folder **/ (root)** → **Save**. After a minute or two the app is live at **`https://nkotwar.github.io/tasc-connect/`**.

## 6. Keep-alive (stops the free database from pausing)

Supabase pauses a free project after 7 days without use. A small GitHub job pings it every 5 days.

1. In the repo: **Add file → Create new file**.
2. For the name, type exactly `.github/workflows/keepalive.yml` (typing the `/` creates the folders).
3. Paste the contents of `keepalive.yml` from the TASC Connect folder → **Commit changes**.
4. **Settings → Actions → General → Workflow permissions** → **Read and write permissions** → **Save**.
5. **Actions** tab → **Keep TASC Connect awake** → **Run workflow**. In about 30 seconds it should show a green tick.

The job also writes the date into `.github/keepalive.txt`. That keeps the repo active, because GitHub switches off scheduled jobs after 60 days without activity. If GitHub ever emails that the workflow was disabled, open Actions and click **Enable workflow**.

## 7. On your phone

1. Open `https://nkotwar.github.io/tasc-connect/` in Chrome → menu ⋮ → **Add to Home screen / Install app**.
2. Open it from the home-screen icon → **Sign in with Google** → choose **nkotwar@gmail.com**. You land straight in, as admin.
3. **Visits → People**: everyone is listed, with who has signed up. Tap anyone for **Call** or **Invite on WhatsApp**.

## How staff get in

Share the link. Staff have two ways in:

- **Sign in with your name** (the main button): they pick their name, enter their date of birth, see their Emp ID, branch and the last 4 digits of their mobile, and confirm. That phone stays signed in until they sign out or clear the browser. Staff and viewers get their full access this way. Admins who sign in this way get only the staff view.
- **Sign in with Google**: works as before. If their Gmail is in udairo.js, they just confirm; otherwise name + date of birth once. Only the admin needs Google.

Every new phone or Gmail shows in **Admin → Activity** and in the person's panel, where you can **Remove** it. You can change roles (Field staff / Viewer / Admin), or **Block** someone, which cuts their access on every phone at once. Staff can see and remove the phones and Gmails linked to their own profile.

To switch on name sign-in (once): Supabase → **Authentication → Sign In / Providers** → turn on **Allow anonymous sign-ins** → Save.

## Updating later

- **Allotting**: Places → **+ Add a new place** has an Allotment part for admins (who, visit by, campaign, note). Any place page has **Allot this place** or **Reallot or change date**.
- **New udairo.js**: Visits → People → **Upload udairo.js**. You see who is new, who moved and who left before you apply. Nobody's history is lost.
- **New app version**: upload the changed files and raise the number in `version.js`. Phones then show **Update now** in Profile.

## Moving photos to Drive

Profile (admins) shows photo storage used, out of the free 1 GB. At **800 MB** it shows a warning. The step-by-step guide for moving photos to Google Drive comes with the photo update, and switching storage won't change anything else in the app.

## Version history

| Version | What changed | Database step |
|---|---|---|
| 1 | Sign-in, profiles, admin people & staff list | `sql/01_schema.sql` + private seed |
| 2 | Logging visits with photos, follow-ups, closures, places, branch-head and admin verification, requests | Run `sql/03_update_v2.sql` once |
| 3 | Fix: admins could not submit visits; Update now works | None |
| 4 | Dashboard for admin and viewers: progress, overdue ageing, business, verification pending, branches, types, officers, follow-ups, photos, WhatsApp nudges, summary image, Excel | None |
| 5 | Summary image lists every branch with totals and a due-tomorrow column; swipe between sections; back button steps back and asks before closing | None |
| 6 | Pull down refreshes the current tab in place; reopening or reloading keeps your tab and section | None |
| 7 | Sections slide as one continuous strip that follows your finger, with neighbours preloaded | None |
| 8 | Sections fill the screen (swipe anywhere); clear empty states with next steps | None |
| 10 | Rolled back version 9 (allotted-to list, staff summary panel, pull panels down to close). Same as version 8 | None |
| 11 | Place shows who it is allotted to; admin's staff panel with visit summary and every allotted place; pull panels down to close; allotments with a pending request are locked | Run `sql/04_update_v11.sql` once |
| 12 | Smoother section swipes; a place allotted to one person but visited by another shows "Visited by …" and counts as visited | Run `sql/05_update_v12.sql` once |
| 13 | Faster, smoother: tabs stay built and refresh quietly, filters don't reload, panels swap content in place | None |
| 14 | Place page always shows who it is allotted to for admin (even before the database update), with a reminder if staff can't see it yet | Run `sql/05_update_v12.sql` if not done |
| 15 | The phone keeps its own copy and syncs only what changed (on open, on return after 2+ min, on pull); your changes go straight into the copy. Hazri-style pull loader; About field guide | Run `sql/06_update_v15.sql` once (after 04 and 05) |
| 16 | New name **TASC Connect** and logo (also on the summary image, Excel and photo stamps). New visits now show in Activity | Run `sql/07_update_v16.sql` |
| 17 | Pull-down emblem spins without the extra ring; clearer message when a request reason is too short | None |
| 18 | "Log visit" is now "Submit Visit Report" (button, form title, hints) | None |
| 19 | Fix: deleting failed with *record "old" has no field "visit_id"*. Photos are now removed only after the visit is deleted | Run `sql/08_fix_v18.sql` once |
| 20 | To do and My visits merged into one **My visits** list with pills: All, Overdue, Today, Upcoming, Visited, Visit Verified (and On hold when any). Big count cards removed | None |
| 21 | Admin: **Upload udairo.js** moved to People (preview opens in a panel); photo storage moved to Profile; Staff list section removed | None |
| 22 | Admin → People: **Due** pill lists staff with allotted visits still pending, with pending and overdue counts | None |
| 23 | Admin notifications removed | Run `sql/09_remove_notifications.sql` once |
| 24 | People opens on **Due**, count cards removed. Places has pills: All, Allotted, Overdue, Visited, Verified, Accounts opened, Not allotted. Dashboard tiles open the matching Places pill; Follow-ups due jumps to its list | None |
| 25 | Every place in Places shows its status (Overdue, Due today/date, Visited, Verified, On hold, closed, Not allotted) and who it is allotted to / last visit | None |
| 26 | Fix: Profile stuck loading (Gmails, photo storage). Server calls give up after 20 s with a Try again instead of spinning forever | None |
| 27 | Visit report form: Headcount (and its Staff/Members dropdown) removed | None |
| 28 | **Sign in with your name** (name + date of birth, Google optional; admin and viewer need Google). Admin can allot a new place while adding it, and **Allot / Reallot or change date** on any place, with a note for staff | Turn on **Allow anonymous sign-ins**, then run `sql/10_update_v28.sql` |
| 29 | Name sign-in shows the exact reason if it fails | None |
| 30 | Pull down works on the sign-in screens too (reloads with the latest app) | None |
| 31 | Branch heads get **My Staff Visits** (their own and branch staff's allotments and reports, pills, person chips with overdue counts, Call / WhatsApp). Only the admin verifies; branch-head Verify removed. App moves to `nkotwar.github.io/tasc-connect/` | Run `sql/11_update_v31.sql`; rename the GitHub repo to `tasc-connect` |
| 32 | New logo: bigger T A S C letters, bank emblem in the centre. Sign-in page footer reads "Central Bank of India · via PDUDAIRO". About guide rewritten for all users (sign-in, roles, Places tags) | None |
| 33 | Viewers can sign in with their name (only the admin needs Google). Excel export redone: Summary, Branches, Officers, Allotments and full Visit reports sheets, with styled headers, filters, totals, ₹ and date formats and status colours | Run `sql/12_update_v33.sql` |
| 34 | Branch table, summary image and Excel get a **Due today** column; the next column is now the next working day (skips Sundays and 2nd / 4th Saturdays, and counts weekend-dated visits) | None |
| 35 | Dashboard: branches A–Z with Udaipur RO first (also in image and Excel); order is By branch, Progress, By type, Officers; Officers pill "Overdue / due today"; tapping a branch opens its panel instead of redrawing. Date of birth is typed as DD-MM-YYYY | None |
| 36 | Dashboard "Waiting for verification" shows only for the admin | None |
| 37 | Summary image footer reads "TASC Connect · Central Bank of India · via PDUDAIRO" | None |
| 38 | Date of birth: type it or tap the calendar button. Dashboard Type / Branch filters stay pinned under the header while scrolling | None |
| 39 | Admin can **Delete this place** (with its allotments and visit reports); shows in Activity | Run `sql/13_update_v39.sql` |
| 40 | Deleting a place asks you to type **delete** first | None |
| 41 | Viewers get a read-only **People** section in Visits (Due, signed up, roles; no dates of birth or Gmails). Both People lists have a branch dropdown | Run `sql/14_update_v41.sql` |
| 42 | Staff who add a place get it allotted to themselves (with a visit date); they can delete a place they added until a visit report exists. **+ Add place** sits beside the search in Places; from My visits it opens the form directly | Run `sql/15_update_v42.sql` |
| 43 | Dashboard → **Pending visits, staff-wise (PDF)** for admin and viewers: overdue and due-today visits, branch by branch and staff by staff, A4 pages; Udaipur RO left out unless ticked | None |
| 44 | "late" now reads "delay" everywhere (e.g. 4 d delay). Pending PDF opens a ready panel with an editable message (counts, how to sign in, link), Share, Copy message and Download | None |
| 45 | Pending PDF and its message no longer mention whether Udaipur RO is included | None |
| 46 | A small floating **Update ready** chip shows on every tab when a new version is out; tapping it opens Profile. The app also checks for updates when you come back to it | None |
| 47 | Test release (no changes) to try the Update ready chip | None |
| 48 | Admin can **Send back** a submitted report with a reason; it counts as pending again (overdue / due, in the PDF too) until the staff member edits and saves it, which resubmits it. Shows in Activity | Run `sql/16_update_v48.sql` |
| 49 | (rolled back) | — |
| 50 | Version 49 undone. Follow-ups in My visits show at any date (no 7-day limit). "Lead status?" replaces "Close this place?". Follow-up date required for Interested / Follow-up needed / Person not available; hidden for Already our customer and closed leads; can be cleared; can't be before the visit date | If you ran `sql/17_update_v49.sql`, run `sql/18_restore_followup_rule.sql` |
| 51 | Dashboard "Latest photos" now shows only the 6 newest, as small thumbnails, 3 per row (two rows); "Show more" removed | Nothing to run. Older versions still show the longer gallery |
| 52 | Admin → Activity: opens on "Attention" (wrong date-of-birth tries, blocks, role changes), filters (All / Visits / People / Places), search by person or place, grouped by day, bulk actions collapsed, "Load more". Faster sync. Small thumbnails for photo lists (new photos only). Old routine Activity rows are cleaned after 90 days | Run `sql/19_update_v52.sql`. Until you do, the new Activity screen shows the latest 150 with the filters applied on the phone. Older app versions keep the old list |
| 53 | Summary image for WhatsApp now asks "Include Udaipur RO" (unchecked by default), like the PDF. Left out, the Regional Office is missing from the branch table and from every total on the image | Nothing to run |
| 54 | Summary image: after making it, a share sheet like the PDF's, with an editable WhatsApp message (totals and the sign-in line), Share with message, Copy message, Download | Nothing to run |
| 55 | Admin can mark a place as duplicate (place page, above Delete place), with an optional note, and unmark it. Nothing is removed: a duplicate keeps its allotment and visit reports, but is left out of To do, My visits, follow-ups, Verify, the Dashboard, PDF, image, Excel and People counts. It shows only in Places → Duplicates (admin and viewers). While marked, no new visit report or allotment on it. Recorded in Activity | Run `sql/20_update_v55.sql`. Older app versions show a duplicate as a normal place until updated; the server refuses new reports or allotments on it |
| 56 | Outcome "Already our customer" now: sets Banks with to Our bank, asks for their existing account number(s) (required), and closes the lead as the new status "Existing customer" (no follow-up). Existing account numbers are kept apart from accounts opened, so they are not counted as business from the visit. With Our bank and any other outcome, the existing account box is optional. Reports already submitted are not changed (an edit applies the rule only if the outcome is changed). Dashboard and Excel show existing customers separately | Run `sql/21_update_v56.sql` before staff update. Older app versions keep the old behaviour and show the new status as a blank "Closed:" label until updated |
| 57 | Existing account number(s) box shows right under Outcome when the outcome is Already our customer (required); with Our bank and any other outcome it stays under Their banking (optional). One box, same numbers | Nothing to run |
| 58 | Admin also gets the People subtab in the Visits tab (same list and actions as Admin → People, which stays) | Nothing to run |
| 59 | People removed from the Admin tab; it lives in Visits → People for the admin (full controls) and viewers (read-only). Admin tab now opens on Verify | Nothing to run |
| 60 | Admin → Verify lists reports in the order they were submitted (oldest first) and shows when each was submitted | Nothing to run |
| 61 | Reassign requests: **Reassign…** opens the same picker as Reallot (search with each person's pending load, Visit by date, note for staff) plus a reply to the requester; the requester is not offered. Pending requests are unaffected. The Campaign box no longer shows when changing an existing allotment (it was never changed there) | Nothing to run |
| 62 | Search boxes in Places, People and Activity show when they are filtering: blue with an × to clear; Places and People add a "Showing n of m · filters · “text” · Clear" line; a kept search glows once when you come back to it | Nothing to run |
| 63 | Report **History**: when the admin sends a report back or unverifies it, the version at that moment is kept; the report page then shows what changed (old → new) and who did it, with the reason. Edits before the admin acts are not recorded; deleted photos are not kept (only the photo count). Unverify asks for an optional reason. Seen by those who can see the full report | Run `sql/22_update_v63.sql`. History starts from then. Older app versions keep working without History |
| 64 | Profile rearranged: Sign out comes right after About / Sync; "Phones and Gmails that open your profile" moved below it as one row (with a count) that opens its own panel; its Remove buttons are no longer red | Nothing to run |
| 65 | Dashboard → Officers: a one-line summary and the 5 officers most behind (with WhatsApp / Call); **See all N officers** opens a panel with search, branch, Overdue / All pills and sorting (most overdue, lowest coverage, most visits, A–Z) | Nothing to run |

---

Built by Nitin Kotwar (139535), via PDUDAIRO.
