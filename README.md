# Kuki API — Azure Migration Guide

## What's in this package

| File | Purpose |
|------|---------|
| `src/index.js` | Express app entry point, all routes wired |
| `src/db/index.js` | Azure SQL connection pool |
| `src/middleware/auth.js` | JWT verification middleware |
| `src/routes/auth.js` | Signup, login, logout, /me |
| `src/routes/profiles.js` | Profile CRUD + photo upload |
| `src/routes/employees.js` | Employee management |
| `src/routes/attendance.js` | Clock in/out, manual entry |
| `src/routes/wages.js` | Wages, loans, bonuses, statements |
| `src/routes/admin.js` | Stats, job roles, ads, subscriptions, logs |
| `src/routes/messages.js` | Messages + job postings |
| `src/utils/storage.js` | Azure Blob Storage for photos |
| `schema.sql` | Run this in Azure SQL to create all tables |
| `frontend-api-client.ts` | Copy to `src/lib/api.ts` in your frontend |
| `AuthContext-new.tsx` | Replace your `src/contexts/AuthContext.tsx` |

---

## Step 1 — Set up Azure SQL

1. In Azure Portal, go to `kuki-db-prod`
2. Open **Query editor** (left sidebar)
3. Paste and run `schema.sql` — this creates all tables

---

## Step 2 — Configure environment variables

Copy `.env.example` to `.env` and fill in:

```
DB_SERVER=kuki-sqlsrv-prod.database.windows.net
DB_NAME=kuki-db-prod
DB_USER=your_sql_admin
DB_PASSWORD=your_sql_password
JWT_SECRET=generate_a_long_random_string_here
AZURE_STORAGE_CONNECTION_STRING=get_from_storage_account_keys
FRONTEND_URL=https://your-app.azurestaticapps.net
```

**Generating a JWT secret:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## Step 3 — Deploy API to App Service

```bash
# Install dependencies
npm install

# Test locally first
npm run dev

# Deploy to Azure App Service
# In Azure Portal → kuki-api-prod → Deployment Center → GitHub
# OR use Azure CLI:
az webapp up --name kuki-api-prod --resource-group kuki-prod
```

Set env vars in Azure Portal:
→ App Service → Configuration → Application settings → add all vars from .env

---

## Step 4 — Update your frontend

1. Copy `frontend-api-client.ts` → `src/lib/api.ts` (replace supabase.ts)
2. Copy `AuthContext-new.tsx` → `src/contexts/AuthContext.tsx`
3. Add to your `.env`:
   ```
   VITE_API_URL=https://kuki-api-prod.azurewebsites.net
   ```
4. In every component that calls `supabase.from('table')`, replace with the matching api call:

| Old (Supabase) | New (API) |
|---|---|
| `supabase.from('profiles').select('*').eq('id', id)` | `profiles.get(id)` |
| `supabase.from('employees').select('*')` | `employees.list()` |
| `supabase.from('wages').select('*')` | `wages.list()` |
| `supabase.from('employee_loans').select('*')` | `wages.loans.list()` |
| `supabase.from('employee_bonuses').select('*')` | `wages.bonuses.list()` |
| `supabase.from('profiles').select('*')` (admin) | `admin.stats()` / `profiles.list()` |
| `supabase.storage.from('avatars').upload(...)` | `profiles.uploadPhoto(id, file)` |

---

## Step 5 — Deploy frontend to Static Web App

1. In Azure Portal → `kuki-frontend-prod` → Deployment Center
2. Connect to your GitHub repo
3. Set build config: `npm run build`, output: `dist`
4. Add env var `VITE_API_URL` in the Static Web App configuration

---

## Azure resources summary for kuki-prod

- `kuki-prod` — Resource Group
- `kuki-asp-prod` — App Service Plan (runs the API)
- `kuki-api-prod` — App Service (this Node.js API)
- `kuki-frontend-prod` — Static Web App (React build)
- `kuki-sqlsrv-prod` — SQL Server
- `kuki-db-prod` — SQL Database
- `kukistorageprod` — Storage Account (profile photos)
- `kuki-insights-prod` — Application Insights (optional)
