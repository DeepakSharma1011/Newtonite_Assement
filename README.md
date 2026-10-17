# Newtonite — Operations Under Pressure Challenge

An operational work item management and tracking system built for fast-moving teams handling incidents, payment investigations, customer escalations, compliance reviews, and daily operations under high pressure.

---

## ⚡ Tech Stack

- **Frontend**: React 18, Vite, TanStack Query (React Query), Modern CSS with Glassmorphic UI & Dark Theme
- **Backend**: Node.js, Express, Prisma ORM
- **Database**: PostgreSQL 16
- **Testing**: Vitest, Supertest
- **Containerization**: Docker & Docker Compose

---

## ✨ Key Features & Architecture

1. **Server-Enforced State Machine Workflow**:
   - `open` ➔ `in_progress` ➔ `awaiting_approval` ➔ `resolved` ➔ `closed`
   - Reopen transitions supported (`resolved` ➔ `in_progress`, etc.)
   - Strict role-based transition guards (e.g., only `lead` or `admin` can approve/resolve from `awaiting_approval`).

2. **Role-Based Access Control (RBAC)**:
   - Team-scoped roles: `admin`, `lead`, `member`, `viewer`
   - Viewers have read-only access
   - Members can create items, update details, transition work
   - Leads and Admins can approve critical state transitions and manage items

3. **Concurrency Control (Optimistic Locking)**:
   - Work items include an incrementing `version` integer
   - Concurrent updates with mismatched version throw `409 Conflict` to prevent overwriting coworker edits under pressure.

4. **Safe Mutations via Idempotency**:
   - Critical POST mutations accept `Idempotency-Key` headers
   - Duplicate network submissions return cached responses safely without double-creation.

5. **Full Audit Trail & Collaboration**:
   - Immutable, append-only `activity_events` logging every change (status, assignee, priority)
   - Real-time item comments for team context.

---

## 🚀 Quick Start (Docker Compose)

The entire application (PostgreSQL + Backend + Frontend) runs with a single command:

```bash
docker compose up --build
```

- **Frontend**: [http://localhost:5173](http://localhost:5173)
- **Backend API**: [http://localhost:3001](http://localhost:3001)
- **Postgres Database**: `localhost:5432`

---

## 🔑 Demo Seed Accounts

All accounts use the password: **`password123`**

| Role | Email | Permissions |
|------|-------|-------------|
| **Admin** | `admin@newtonite.internal` | Full management access across teams |
| **Lead (Ops)** | `lead@newtonite.internal` | Operations lead: item assignment & approvals |
| **Member (Ops)** | `member@newtonite.internal` | Active operational responder |
| **Viewer** | `viewer@newtonite.internal` | Read-only observer |

---

## 🛠️ Local Development (Without Docker)

### 1. Prerequisites
- Node.js (v18+)
- PostgreSQL (running locally on port 5432)

### 2. Backend Setup
```bash
cd backend
npm install
# Configure .env (DATABASE_URL, JWT_SECRET, PORT)
npx prisma migrate deploy
npm run seed
npm run dev
```

### 3. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

### 4. Running Backend Tests
```bash
cd backend
npm test
```

---

## 📁 Repository Structure

```
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma       # Database schema & relationships
│   │   ├── seed.js             # Seed data with teams, users, items
│   │   └── migrations/         # SQL migration scripts
│   ├── src/
│   │   ├── lib/                # Workflow state machine & Prisma client
│   │   ├── middleware/         # Auth, RBAC, Idempotency, Validation
│   │   ├── routes/             # REST API routes (auth, items, teams, etc.)
│   │   └── index.js            # Express server entry point
│   ├── tests/                  # Integration and unit tests
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/         # Modals, Badges, Activity timeline, Comments
│   │   ├── context/            # AuthContext & session management
│   │   ├── pages/              # Dashboard, Work Items list, Detail page
│   │   └── App.jsx
│   ├── nginx.conf
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```
