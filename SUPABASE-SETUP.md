# Finish connecting Bear & Bull Club

The website uses your Supabase project and a public publishable key. No secret
key or database password belongs in the website files.

## 1. Create the database

Open https://supabase.com/dashboard/project/eqqneucvsyfdmxekvbzt/sql/new
and paste the entire contents of `supabase-setup.sql`. Click Run.
This creates an empty shared portfolio with $10,000 cash. Rerunning the SQL
preserves existing club data and approved editors.

## 2. Configure sign-in and create your account

In Authentication, disable **Allow new users to sign up**. Keep email/password
sign-in enabled. In Authentication > URL Configuration use this for Site URL
and an allowed Redirect URL:

https://scream325.github.io/bear-and-bull-website/

In Authentication > Users, choose **Add user > Create new user**. Enter your
editor email and a new strong password, and use the dashboard's auto-confirm
option. This creates an account directly; no invitation email flow is needed.
Keep the password private. Do not reuse the old published club password.

## 3. Approve the account as a club editor

Run this separate query in SQL Editor, replacing the example email:

```sql
insert into public.club_editors (user_id)
select id from auth.users where lower(email) = lower('YOUR-EMAIL-HERE')
on conflict (user_id) do nothing;
```

Confirm there is one row in `club_editors` in Table Editor. If there is no row,
check that the email matches a user created in the previous step. Creating an
Auth user alone does not grant permission to edit. Repeat for other officers.
To revoke access, delete that officer's row from `club_editors` in the dashboard.

## 4. Publish the updated site

Upload the updated HTML, CSS, JavaScript, images, and the `vendor` folder to the
GitHub repository. `vendor/supabase.js` is Supabase JS 2.116.0; its license is
included. Remove `password.txt` from the published repository: it is no longer
used. `.gitignore` prevents new accidental additions but cannot unpublish an
already tracked file or erase past commits. Retire the old password.

## 5. Sign in and migrate existing data

Open the website and wait for **Shared portfolio loaded**. Sign in at the bottom
with your new email and password. If you previously saved data in this browser,
an **Import this browser's previous picks and portfolio** button appears while
the shared database is still empty. Use the same browser and website address
where you made those edits. Import before adding new shared data.

Old browser data is preserved; it is not uploaded automatically. If you already
have data, download your text backup from the old site before publishing these
changes. Browser-only data from a local file URL is separate from GitHub Pages
data, so keep its text backup and enter those holdings on the live site.

Check **All changes saved** after editing, then open the site in another browser
to confirm the same values appear without signing in. Visitors can read picks,
holder names, holdings, and valuation history, so enter only public club data.

Concurrent edits cannot silently overwrite each other: the second editor gets
a conflict message and can download unsaved work before reloading. Failed saves
also provide retry and download controls. The page warns before leaving with
unsaved work. Normal edits are stored in Supabase; downloaded text backups remain
optional extra copies.

## Local verification

Run `node tests/cloud.test.cjs` for the browser-logic tests with mocked Supabase.
The database permission tests use a disposable PostgreSQL instance supplied by
`@electric-sql/pglite`:

```text
node tests/database.test.mjs /path/to/@electric-sql/pglite/dist/index.js
```

These tests do not modify your live Supabase project.

## What protects the data

Public visitors have read-only database access. Signed-in accounts can check
their own editor approval. Only the save function can change the shared state;
it verifies editor approval, validates the data, and checks its revision. Neither
ordinary users nor the public publishable key can add editors or write directly
to the tables. Browser visibility of the edit controls is only a convenience.
