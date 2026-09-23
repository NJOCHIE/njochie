# Njochie

A production-oriented private message service: creators write a message, set a personal question and answer, then share a unique link. The recipient must answer correctly before the message is revealed.

## Stack
- Express on Node.js
- Supabase Auth
- Supabase PostgreSQL
- Vanilla HTML/CSS/JS frontend
- Vercel deployment configuration

## 1. Configure Supabase
1. Create/open your Supabase project.
2. Open **SQL Editor** and run `schema.sql`.
3. In Project Settings/API, copy the project URL, browser-safe anon/publishable key, and server-only service role key.
4. Enable email/password authentication in Supabase Auth.

## 2. Local environment
Copy `.env.example` to `.env` and fill in the variables. Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser code or commit it to Git.

```bash
npm install
npm start
```
Then open http://localhost:3000.

## 3. Deploy to Vercel
Import the repository into Vercel and add these environment variables:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_URL` (set this after the Vercel domain is known)
- `NODE_ENV=production`

After deployment, update Supabase Auth URL/redirect settings so the production Vercel URL is allowed.

## Security notes
The answer is hashed and never returned to the browser. The reveal operation is performed by a PostgreSQL function with row locking. The service-role key is server-only. For a larger production launch, add a dedicated rate-limit store/WAF rules, structured logging, security headers/CSP, monitoring, backups, and automated tests.
