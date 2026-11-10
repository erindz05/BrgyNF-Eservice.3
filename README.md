# Barangay North Fairview eServices Portal  (version 2)

```
brgy-eservices/
├── frontend/                  <- the website (what people see)
│   ├── index.html
│   ├── style.css
│   ├── script.js
│   └── config.js              <- the ONLY file you edit (keys, pictures, signatory name)
├── database/
│   └── supabase_setup.sql     <- tables, privacy rules (RLS), admin role, fees, reference numbers
└── backend/
    └── supabase/
        ├── config.toml
        └── functions/
            ├── create-payment/index.ts     <- makes the PayMongo payment link (secret key stays here)
            └── paymongo-webhook/index.ts   <- PayMongo tells us "paid" -> status updates automatically
```

## How the website works
1. The first screen asks: **Applicant** or **Administrator**.
2. **Applicant** -> fills the Business Permit or Barangay Clearance form -> gets a reference number (like `26-1001`) -> can check the status anytime. Applicants never see the certificate and cannot print or export anything.
3. **Administrator** -> must log in -> sees every detail, uploaded requirements, and the certificate. Only here are **Print** and **Export PDF** available. The admin can also change the prices.
4. The QR code at the bottom of the page opens the website (it is not printed on documents).

## Try it right now (no setup)
Open `frontend/index.html` (or upload the `frontend` folder to spck.io and run it).
Without keys it runs in DEMO MODE: data stays in your own browser.
Demo admin login: `demo@brgy.local` / `demo1234`.

## Go live - step by step

### 1. Create the Supabase project
supabase.com -> New project. Then Project Settings -> API: copy the **Project URL** and the **anon public** key.

### 2. Create the database
Supabase -> SQL Editor -> paste all of `database/supabase_setup.sql` -> Run. (Safe to run again.)

### 3. Create the admin
1. Authentication -> Users -> Add user (email + password, tick **Auto Confirm**). Use a long, unique password.
2. SQL Editor, run (use your email):
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'officer@barangay.gov.ph';
   ```
3. Authentication -> Providers -> Email -> turn OFF "Allow new users to sign up".

### 4. Put your keys in the website
Edit `frontend/config.js`: paste the Project URL and anon key. Never paste the `service_role` key here.
Payment is manual until step 5: the admin presses **Mark as Paid**.

### 5. (Optional) Automatic online payment with PayMongo
Do this in PayMongo **test mode** first (sk_test_... keys).

**a. Deploy the functions.** Supabase -> Edge Functions -> Deploy a new function (editor in the dashboard):
- name `create-payment` -> paste `backend/supabase/functions/create-payment/index.ts` -> Deploy.
- name `paymongo-webhook` -> paste `.../paymongo-webhook/index.ts` -> Deploy, then open its settings and turn **OFF "Verify JWT"**.
(CLI users: `supabase functions deploy create-payment` and `supabase functions deploy paymongo-webhook --no-verify-jwt`.)

**b. Add the secret key.** Edge Functions -> Secrets -> add `PAYMONGO_SECRET_KEY` = your `sk_test_...` key.

**c. Create the webhook in PayMongo.** Dashboard -> Developers -> Webhooks -> Add:
- URL: `https://YOUR-PROJECT-ID.supabase.co/functions/v1/paymongo-webhook`
- Event: `link.payment.paid`
- Copy the signing secret it shows (starts with `whsk_`) and add it in Supabase Secrets as `PAYMONGO_WEBHOOK_SECRET`.

**d. Turn it on.** In `frontend/config.js` set `ENABLE_ONLINE_PAYMENT = true`.

**e. Test.** Apply -> tap the pay button -> pay with a PayMongo test method -> tap "I already paid" -> the status becomes PAID. Use `sk_live_...` keys and a live webhook only after this works.

### 6. Publish the website
Upload the `frontend` folder to GitHub Pages, Netlify or Cloudflare Pages. `index.html` must be in the root.
Then put your real link in `config.js` (`SITE_URL`) so the website QR code points to it.

## Changing the prices
Log in as Administrator -> open **Fees (Permit & Clearance prices)** -> type the new amounts -> **Save New Prices**.
Applicants see the new price immediately, and the payment function charges the new price (it reads the same table).
(Advanced: the prices live in the `fees` table in Supabase.)

## Adding your pictures (logo, banner, signature...)
Open `frontend/config.js` and fill the `IMAGES` section. Each picture can be:
- a file next to `index.html`, e.g. `"logo.png"` - the name must match EXACTLY (lowercase, correct extension, same folder);
- a web link, e.g. `"https://.../logo.png"`;
- the picture itself as Base64 text, `"data:image/png;base64,...."` - works everywhere, including spck.io previews. Make the picture small first (under ~200 KB), then convert it with any "image to Base64" website and paste the result between the quotes.

Where each picture appears: `logo` (top-left and on the certificate), `banner` (behind the green title area), `seal` and `bagongPilipinas` (certificate header), `signature` (above the Punong Barangay's name), `certificateBackground` (faded picture behind the certificate).
The Punong Barangay's name printed on certificates is `PUNONG_BARANGAY` in `config.js`.

## Who can see what
| Who | Can see |
|---|---|
| Applicant (after applying) | Reference no., name, type, fee, status |
| Anyone checking a reference number | Masked name (O***** R******), type, status |
| Administrator (logged in AND listed in `admins`) | Everything, uploaded requirements, certificate, Print / Export PDF, fees |

## How the administrator area is protected
Choosing "Administrator" on the first screen is only a menu choice. The real protection is in Supabase:
1. Applicant data can only be READ by a logged-in user who is also listed in the `admins` table (Row Level Security). A resident who opens the admin screen sees only a login box; Supabase returns nothing to anyone else, even if they edit the website code.
2. Sign-ups are turned off, so nobody can create an account. Only accounts YOU add can log in.
3. Uploaded requirements are in a private bucket and open through links that expire in 5 minutes.
4. Prices are changed only by admins (database rule) and the payment amount is decided on the server.
5. Leaving the admin screen signs out and clears the confidential details from the screen.
Keep the admin password private, use a different strong password per officer, and never share the `service_role` key.

## Notes
- Reference numbers look like `26-1001` (year + running number, digits only) and are created by the database, so they are never duplicated.
- The certificate wording for "Barangay Clearance" is a simple template; adjust it in `renderCertificate()` in `script.js` to match the barangay's official wording.
- Test data can be deleted in Supabase -> Table Editor -> `clearances`.
- The payment functions were tested with simulated PayMongo requests. Test once with real PayMongo test keys before going live.
