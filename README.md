# SALS Security Team — Security Incident Report (Form OEF-23)

Centralized security incident statement reporting, registry management, and verification workspace designed for the SALS Security Team. Runs as a standalone Node.js server powered by Google AI Studio.

---

## Key Features & Architecture

### 1. Incident Statement Workspace
- **Standardized Form OEF-23:** Complete digital form capturing report metadata, supervisor, employee details, passport/ID, department, agency, incident type, location, incident timestamp, asset details, estimated value, status, narrative description, reference information, investigating officer actions/comments, police station details, and recording officer information.
- **Section Badges & ScrollSpy Navigation:** 7 numbered sections (01 Report Info, 02 Incident Details, 03 Description, 04 Reference, 05 Statement, 06 Officer Action, 07 Police & Sign) with dynamic completion checkmarks (`✓`) and smooth viewport ScrollSpy tracking.
- **Interactive Status Stepper:** Visual 4-stage lifecycle tracker (`Open` → `Under Investigation` → `Pending Police Report` → `Closed`) with one-click status transitions.
- **Independent Complainant Name:** The subject employee name and complainant signature name operate completely independently with isolated event handlers, allowing accurate recording when the complainant is not the subject employee.
- **Signature Verification:** On-screen touch canvas elements have been streamlined in favor of dedicated, high-contrast signature spaces on generated PDFs for physical or digital pen execution. Legacy signatures in historical records remain preserved.

### 2. Incident Registry
- **Central Registry:** Access all historical records through the **Incident Registry** tab with background polling (every 10 seconds while visible and on window focus). Active form inputs in the statement workspace are never overwritten by background syncs.
- **Quick Filters & Search:** Real-time text search across report numbers, employee names, complainants, departments, locations, and incident types, paired with quick date filter chips (`All`, `Today`, `Week`, `Month`).
- **Modal Detail Viewers:** Clickable chips for incident types and descriptions in the registry table open clean modal dialogs to read full text without navigating away.
- **Concurrency & Versioning:** Every report maintains an incremental `_version` attribute. Stale updates or simultaneous edits return conflict warnings rather than silently overwriting another officer's submission.
- **Unique Numeric Numbering:** All reports enforce formatted 3-digit numeric report numbers (e.g., `169`).
- **Admin-Only Bulk Deletion:** Administrators can purge reports in bulk with mandatory two-step confirmation (typing `DELETE ALL`) and report-count verification, while protecting existing user accounts.

### 3. Client-Side PDF Generation & Live Preview
- **Live In-App PDF Preview:** Dedicated modal with an interactive preview iframe allowing officers to inspect the exact document layout before printing or exporting.
- **Privacy-First In-Browser Generation:** A4 PDF documents are generated entirely in the user's browser using vendored `pdf-lib` (located in `public/vendor/`). No incident details or names are ever transmitted to external rendering services.
- **Spreadsheet Grid Precision:** Strict adherence to the official OEF-23 grid layout, including confidential watermark, header branding, bordered cells, and auto-scaled text fitting for lengthy narrative entries.
- **Dual Signature Blocks:** Renders two designated signature areas:
  1. *Signature of Complainant*
  2. *Signature of Recording Officer*
- **Audit Attribution:** PDF and print footers explicitly reflect the authenticated user who prepared or exported the draft (`Prepared by: <username>`).
- **Dual Export Controls:** Direct print dialog trigger (`Print / PDF`) and direct `.pdf` file download (`Export PDF`).

### 4. Authentication & Role-Based Access Control (RBAC)
- **Role Hierarchy:**
  - **Admin:** Full access to reports, user creation, user deletion, credential management, bulk report deletion, and credential backup/restore.
  - **Standard User:** Create, view, edit, search, and export incident statements and reports. User management and bulk deletion APIs are strictly blocked.
  - **Print & Preview Only (Viewer):** Restricted read-only role designed for auditors and review personnel. Users with this role can preview and print/export reports, but all create, edit, save, and delete actions are blocked. Both administrators and standard users can create Print & Preview IDs.
- **Security Hardening:**
  - Salted PBKDF2-SHA256 password hashing (100,000 iterations, 32-byte salt).
  - Secure session cookies (`__Host-oef_session`, `SameSite=None`, `Partitioned`, `Secure`, `HttpOnly`) with fallback `Authorization: Bearer <token>` header support for iframe environments.
  - Brute-force throttling per IP (maximum 20 failed login attempts per 15-minute sliding window).
  - Security headers on all API responses (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`).
- **Initial Credentials:** First deployment initializes an administrative account with username `admin` and password `admin`.
- **User Account Backup & Restore:** Administrators can export and import user accounts via encrypted/hashed JSON backups.
- **Report Registry Backup & Export:** One-click CSV export (`OEF23_Register_*.csv`) and complete JSON backup/restore (`OEF23_Backup_*.json`).

### 5. Login Interface & Brand Presentation
- **SALS Security Branding:** Prominent, centered SALS emblem above the credentials box.
- **Clean Credentials Card:** Focused sign-in form with toggleable password visibility and clear error messaging.
- **Subtitle:** Identifies the workspace as `Security Incident Report · Form OEF-23`.
- **Support Notice:** Administrator assistance contact notice (`Need an account? Contact your administrator.`).
- **Version Badge:** Dynamic version badge (`v1.0.0`) verified via the public `/api/version` endpoint.
- **Legal & Property Notice:** Official property statement centered beneath the login card:
  > *© 2026 SALS Security Team. All rights reserved.*  
  > *This is the property of SALS Security Team and may not be reproduced, distributed, or used without prior written authorization.*

### 6. Compact UI & Theming
- **Dark Mode by Default:** Cyber Serif high-contrast dark theme enabled by default with one-click toggle in the account dropdown menu.
- **Space-Efficient Design:** Dense tabular layouts, compact action buttons, and responsive breakpoints adapting from wide desktop screens to mobile tablets.

---

## Running with Google AI Studio

The application runs as a standalone Node.js server with Google AI Studio as the hosting environment:

- **Server Entry Point:** `server.mjs` running on `PORT 3000` (`0.0.0.0`).
- **Native SQLite:** Powered by Node.js built-in `node:sqlite` (`DatabaseSync`).
- **Automatic Schema Initialization:** Database tables (`reports`, `users`, `sessions`, `login_limits`) are provisioned automatically on startup or first request.
- **Graceful Shutdown:** Tracks in-flight requests and drains them on `SIGTERM`/`SIGINT` with a 30-second timeout.

### Start Commands
```bash
# Install dependencies
npm install

# Start the server (development or production)
npm start
# or
npm run dev
```

---

## API Endpoints

| Method | Route | Access | Description |
|---|---|---|---|
| `GET` | `/api/version` | Public | Returns build number, app version, and formatted display string. |
| `GET` | `/api/health` | Public | Health check endpoint for uptime monitoring and database connectivity. |
| `POST` | `/api/login` | Public | Authenticates credentials with rate-limiting; sets session token. |
| `POST` | `/api/logout` | Authenticated | Revokes current session token server-side. |
| `GET` | `/api/session` | Authenticated | Validates session token and returns active user profile and role. |
| `GET` | `/api/reports` | Authenticated | Retrieves all reports sorted descending by report number. |
| `POST` | `/api/reports` | Standard / Admin | Creates a new report record; assigns authenticated `preparedBy`. |
| `PUT` | `/api/reports/:id` | Standard / Admin | Updates an existing report with optimistic concurrency validation. |
| `DELETE` | `/api/reports/:id` | Standard / Admin | Deletes an individual report with version verification. |
| `DELETE` | `/api/reports` | Admin only | Bulk purges all reports (requires confirmation and count). |
| `POST` | `/api/reports/restore-seed` | Authenticated | Seeds/restores report database from JSON backup or registry export. |
| `GET` | `/api/users` | Admin only | Lists all registered accounts and assigned roles. |
| `POST` | `/api/users` | Standard / Admin | Creates a new user account (standard users can provision `viewer` accounts; admins can provision any role). |
| `DELETE` | `/api/users` | Admin only | Deletes a user account while safely preserving their submitted reports. |
| `GET` | `/api/users/backup` | Admin only | Exports JSON credential backup of all users. |
| `POST` | `/api/users/backup`| Admin only | Restores user accounts from a valid backup file. |

---

## Development & Tooling

### Code Quality
- **ESLint:** Code linting with `eslint:recommended` rules. Run with `npm run lint`.
- **Prettier:** Code formatting with single quotes, no semicolons, 120 character width. Run with `npm run format`.
- **Node Syntax Checks:** Server and client scripts checked via `node --check`.

### CI/CD
- **GitHub Actions:** Automated lint and test pipeline on every push and pull request to `main`.

---

## Verification & Automated Tests

Run the full automated test suite using:
```bash
npm test
```

The test runner validates:
1. **`tests/signatures.cjs`:** Asserts removal of on-screen canvas inputs, validates dual signature spaces in generated PDFs, and verifies historical signature image preservation.
2. **`tests/shared.mjs`:** Comprehensive SQLite integration suite verifying multi-user read/write isolation, concurrent update conflicts, bulk deletion guards, credential hashing, session expiration, viewer ID restrictions, and role escalation prevention.
3. **`tests/pdf.cjs`:** Validates client-side A4 PDF output, statement auto-pagination, report registry export, and print dialog controls.
