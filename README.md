# Covers: restaurant visits dashboard

PHP + MySQL (Aiven) + Chart.js. No Shiny, no build step.

```
public/index.html      page
public/api.php         one JSON endpoint; runs the SQL
public/assets/         app.js (charts), style.css
src/bootstrap.php      settings, Aiven TLS connection, optional login
Dockerfile             for hosting
```

## 1. Run it locally

You need PHP 8.1+ with the `pdo_mysql` extension (MAMP includes both).

1. Put this folder inside your R project, for example `my-project/dashboard/`.
2. Copy `.env.example` to `.env` and fill in the host, port, database, user and password from the Aiven console (Overview tab).
3. In the Aiven console, download **CA certificate** and save it as `ca.pem` in this folder.
4. In RStudio, open the Terminal tab and run:
   ```
   cd dashboard
   php -S localhost:8000 -t public
   ```
5. Open http://localhost:8000. If you see an error banner, set `APP_DEBUG=1` in `.env` and reload.

With MAMP instead: set the document root to the `public` folder.

## 2. Put it on the web (Render, free tier)

1. Push the folder to a GitHub repo. `.env` and `ca.pem` are git-ignored, so your credentials stay out of it.
2. On render.com choose **New, Web Service**, pick the repo, and set **Language: Docker**.
3. Under **Environment**, add `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS`, and `DB_SSL_CA_PEM` (paste the contents of `ca.pem`).
4. Deploy. Render gives you a public `https://...onrender.com` URL.
5. In Aiven, check the service's **Allowed IP addresses**. The default allows all; if you restricted it, add Render's outbound IPs.

The free tier sleeps when idle, so the first load after a break takes about a minute. Railway, Fly.io or any PHP host also work: use the Dockerfile, or upload `public/` and `src/` to a PHP host and set the same variables.

Set `DASH_USER` and `DASH_PASS` if the dashboard should not be public. It shows customer names.
