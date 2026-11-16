# Motion Dojo Connect

A community space for Keyframe Ninjas, the students of Black Belt in Motion Design.

- **Community feed:** the grand sensei posts here and every student gets a notification.
- **Everyone / Connections feeds:** work from all Ninjas, or only from the people you're connected with.
- **Students directory** with search and filters by skill and Black Belt phase.
- **Profiles** with cover image, photo, bio, links and a grid of work.
- **Posts:** an image or a YouTube, Vimeo, Instagram or TikTok link, tagged "Just sharing" or "I want feedback", with likes, comments and bookmarks (Saved).
- **Connections:** send a request; the other person accepts or declines. Messages only work between connected members.
- **Notifications** (the bell), reports, blocks and moderators.
- **Scam protection:** "aza", "acct", "a/c", "account number/no", "acc no" and standalone 10-digit numbers can't be posted or sent anywhere.

Who can do what is enforced by the database (`supabase/schema.sql`, row-level security), not only by the app:

| | Browse | Like, comment, save, connect | Message | Post work | Post to Community |
|---|---|---|---|---|---|
| Visitor (not signed in) | ✓ | | | | |
| Signed-in member | ✓ | ✓ | connected only | | |
| Keyframe Ninja (student) | ✓ | ✓ | connected only | ✓ | |
| Grand sensei | ✓ | ✓ | connected only | ✓ | ✓ |

Until Supabase keys are set, the app runs as a preview with clearly labelled sample members.

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in the Supabase keys
npm run dev
```

## Set up (one time)

1. **Supabase:** create a project at [supabase.com](https://supabase.com). In SQL Editor, paste all of `supabase/schema.sql` and run it.
2. **Supabase → Authentication → URL Configuration:** set the Site URL to your Connect domain and add it to Redirect URLs.
3. **Supabase → Authentication → SMTP:** connect an email service (for example Resend). The built-in sender only sends a few sign-in emails per hour.
4. **Vercel:** import this repo as a new project. In Settings → Environment Variables add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and optionally `NEXT_PUBLIC_MAIN_SITE_URL` (all as Config), plus `SUPABASE_SERVICE_ROLE_KEY` (the `sb_secret_…` key, as Secret) for student ID sign-in. Add your Connect domain under Domains.
5. **Grand sensei:** sign in to Connect once, then in Supabase → Table Editor → `profiles`, tick `is_sensei` on your row.
6. **Moderators:** tick `is_moderator` on their rows. They can remove any post or comment and read `reports`.

## Signing in

- **Keyframe Ninjas:** email + student ID (`MD-XXXX-XXXX`). Every row in `enrolments` gets an ID automatically. Students see theirs after paying on the Motion Dojo site; to look one up, run `select email, student_id from enrolments;`. The check runs in `src/app/api/student-login` and no email is sent.
- **Everyone else** (and students who lost their ID): an email sign-in link.
- Set up the database before 16 Nov 2026? Run `supabase/update-all.sql` once (student IDs, text posts, phase privacy, chat files and ticks). Safe to run again.

## Student verification

A member becomes a Keyframe Ninja when the email they sign in with is in the `enrolments` table:

- **Paid through Paystack:** the Motion Dojo site's Paystack webhook (`motiondojo` repo, `src/app/api/paystack-webhook`) records the email automatically. In the **motiondojo** Vercel project, set `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to this same Supabase project.
- **Paid another way:** add their email to `enrolments` in the Table Editor, or add a code to `invite_codes` and give it to them (use long random codes, e.g. `NINJA-7K2Q-9XMD`). They enter it under Edit profile.

## Where things are

- `src/connect/ConnectApp.tsx`: app shell, navigation, routes
- `src/connect/screens-*.tsx`: the screens
- `src/connect/live-api.ts`: all Supabase access (the only file that talks to the database)
- `src/connect/demo-api.ts`: the sample-data preview
- `src/connect/safety.ts`: the payment-details filter (keep in step with `has_payment_details` in the schema)
- `supabase/schema.sql`: tables, security rules, triggers; safe to re-run

## Cloudflare R2 (videos and chat files)

Post videos and everything sent in chats (photos, videos, files, voice notes) go to R2 when it's set up; photos on posts, avatars and covers stay on Supabase. Without R2 everything uses Supabase.

- `md-media`: public bucket, post videos (`videos/<user>/...`)
- `md-chat`: private bucket, chat files (`<conversation id>/...`); the app gets 6-hour read links from `/api/r2/read`, only for people in that chat
- Uploads: `/api/r2/upload` checks who's asking and returns a 15-minute upload link (signed with `src/lib/r2.ts`)

CORS policy for both buckets:

```json
[
  {
    "AllowedOrigins": ["https://connect.joinmotiondojo.com"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```
