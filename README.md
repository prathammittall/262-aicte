# Integrated AICTE Approval Workflow Automation, Compliance Monitoring and Alert Management System
> **AICTE Problem Statement ID 26262**

A full-stack enterprise web application and configurable workflow engine designed to centralize technical institution approval applications, scrutiny routing, Expert Visit Committee (EVC) scheduling, time-bound undertakings, institutional compliance, lease and document validity tracking, notifications, escalation, and immutable audit trails.

---

## 1. System Overview & Core Principles

- **Administrative Automation**: Automates workflow routing, deadline tracking, and compliance alerting without replacing statutory discretion reserved for competent AICTE authorities.
- **Rule-Driven Workflow Engine**: Dynamic, versioned workflow templates support varied sequences (e.g., Scrutiny → Decision, Scrutiny → EVC → Decision, Scrutiny → Committee Review). Active cases permanently retain their assigned version to prevent retroactive flight path alteration.
- **Multi-Role Governance**: Real-time role-adapted workspaces with strict server-side RBAC and jurisdiction isolation across Northern and Western regions.
- **Auditable & Accountable**: Every consequential state change, return-for-clarification, observation, inspection report, document renewal, and decision is recorded in an immutable audit log.
- **Synthetic Demonstration Environment**: All institutions, applications, inspection dates, and deadlines are synthetic and clearly marked for prototype demonstration.

---

## 2. Technology Stack

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript (strict type checking), Tailwind CSS v4, Lucide React icons.
- **Backend**: Node.js, Express, TypeScript, REST API with cookie/session authentication, Multer with file signature (magic bytes) validation.
- **Database & ORM**: PostgreSQL (hosted on Neon), Prisma ORM (Prisma 8 RC with contract-driven PostgreSQL client).
- **Architecture**: Modular Monorepo managed via Turborepo (`apps/server`, `apps/web`, `@repo/ui`).

---

## 3. Demonstration Personas & Quick Switcher

The web portal includes a **1-Click Persona Switcher** at the top of the screen to seamlessly experience each user role without typing passwords:

| Role | Persona Name | Demo Account Email | Default Password | Primary Scope & Responsibilities |
|---|---|---|---|---|
| **Super Administrator** | Aarav Mehta | `admin@demo.aicte.local` | `DemoPass!2026` | Workflow studio, version publishing, deadline check trigger, audit log search |
| **Bureau Officer** | Sanjay Deshmukh | `bureau@demo.aicte.local` | `DemoPass!2026` | National backlog analytics, stage pendency, escalated cases review |
| **Competent Authority** | Dr. Vikram Malhotra | `authority@demo.aicte.local` | `DemoPass!2026` | Statutory decisions: Approve, Approve with Undertakings, Reject with formal order notes |
| **Regional Officer** | Rohan Verma | `north@demo.aicte.local` | `DemoPass!2026` | Northern Region application review, EVC scheduling, regional pendency |
| **Scrutiny Officer** | Isha Nair | `scrutiny@demo.aicte.local` | `DemoPass!2026` | Scrutiny observations checklist, deficiency recording, return for correction |
| **EVC Member** | Dev Patel | `evc@demo.aicte.local` | `DemoPass!2026` | Assigned inspection visits, physical inspection reports, committee recommendations |
| **Institution Administrator** | Ananya Sharma | `institution@demo.aicte.local` | `DemoPass!2026` | North Valley Institute of Technology: Intake submission, resubmissions, compliance evidence, document renewal |

---

## 4. Key Workspaces & Capabilities

### A. Approval Application Lifecycle
- Application intake wizard with academic cycle, application type, and published workflow selection.
- Unique application identifiers (`AICTE/2026/...`).
- Validated state progression: `Scrutiny` ⇄ `Correction` → `EVC` → `Committee review` → `Completed (Approved / Rejected)`.
- Detailed case drawer with stage timeline, assignee, due dates, case summary, and scrutiny observations.

### B. Scrutiny & Deficiency Module
- Authorized officers record granular observations with status (`Satisfactory` or `Deficient`) across categories (Land & Infrastructure, Faculty Norms, Financial Soundness, Safety NOCs).
- Return for correction with mandatory deficiency reasons.
- Owning institutions review deficiency notices and resubmit remediation evidence.

### C. EVC Scheduling & Inspection Reports
- Applications at `EVC` stage are scheduled with visit date/time, committee assignment, and conflict checking.
- Committee members submit official inspection findings and recommendations (`Recommended`, `Conditional`, `Not Recommended`).
- Completed inspections advance applications to Committee review.

### D. Competent Authority Decision Engine
- Competent authorities record statutory decisions (`Approve`, `Approve with Conditional Undertakings`, `Reject`).
- Mandatory statutory reasoning / order summary.
- Conditional approval automatically spawns tracked compliance undertakings with assigned verification deadlines.

### E. Lease & Document Validity Monitoring
- Multi-dimensional tracking of lease agreements, approvals, and certificates.
- Expiry alerts for documents expiring in ≤90 days, ≤30 days, or already expired.
- Versioned document renewal flow preserving historical versions and resetting verification status.

### F. Deadline Engine & Escalations
- Background deadline checks flag cases exceeding due dates and generate persistent escalation records.
- Idempotent processing prevents duplicate alerts.
- Dedicated escalation queue with resolution recording.

### G. Operational Intelligence & Reports
- Real-time calculations of stage-wise backlog, regional pendency, application ageing (0-7, 8-30, 31-60, >60 days), and overdue cases by officer.
- Authorised CSV export (`/api/reports/applications.csv`).

---

## 5. Getting Started & Local Development

### Prerequisites
- Node.js >= 20
- npm >= 10

### Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/prathammittall/262-aicte.git
cd 262-aicte
npm install
```

### Environment Configuration
The server `.env` in `apps/server/.env` is pre-configured with the Neon PostgreSQL database connection string.

### Run Development Servers
Start both backend (Port 3000) and frontend (Port 3001) concurrently:
```bash
npm run dev
```

- **Frontend Application**: [http://localhost:3001](http://localhost:3001)
- **Backend API**: [http://localhost:3000](http://localhost:3000)

### Type Checking & Build Verification
Verify type safety across all packages:
```bash
npm run check-types
```

Build production bundles:
```bash
npm run build
```

---

## 6. API Reference Summary

| Method | Endpoint | Authorized Roles | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | Public | Authenticate with email and password |
| `POST` | `/api/auth/demo-switch` | Public | Instant 1-click persona switch for demonstration |
| `POST` | `/api/auth/logout` | Authenticated | Terminate session cookie |
| `GET` | `/api/dashboard` | Authenticated | Role-scoped operational metrics and stage distributions |
| `GET` | `/api/applications` | Authenticated | List authorized applications with filters |
| `POST` | `/api/applications` | Inst, Admin, Reg, Cent | Register new application in active workflow |
| `POST` | `/api/applications/:id/transition` | Scrutiny, Reg, Inst, Admin | Advance, return, or resubmit application |
| `GET` | `/api/applications/:id/scrutiny` | Authenticated | Retrieve scrutiny observations for application |
| `POST` | `/api/applications/:id/scrutiny` | Scrutiny, Reg, Admin | Record granular observation finding |
| `POST` | `/api/applications/:id/decision` | Authority, Central, Admin | Record statutory approval, conditional, or rejection |
| `GET` | `/api/evc` | EVC, Reg, Central, Admin | List scheduled EVC inspection visits |
| `POST` | `/api/evc` | Reg, Central, Admin | Schedule visit date, committee, and location |
| `POST` | `/api/evc/:id/report` | EVC, Central, Reg, Admin | Submit committee inspection report & recommendations |
| `GET` | `/api/compliance` | Authenticated | List approval undertakings and conditions |
| `POST` | `/api/compliance/:id/submit` | Institution | Submit compliance evidence reference |
| `POST` | `/api/compliance/:id/decision` | Officers, Admin | Verify evidence or request correction |
| `GET` | `/api/documents` | Authenticated | Track institutional documents and expiry |
| `POST` | `/api/documents/upload` | Inst, Officers, Admin | Upload private document with magic-bytes check |
| `POST` | `/api/documents/:id/renew` | Inst, Officers, Admin | Submit renewed version with new validity date |
| `GET` | `/api/escalations` | Officers, Authority, Admin | Escalated cases exceeding deadlines |
| `POST` | `/api/escalations/:id/resolve` | Officers, Admin | Record escalation resolution in audit trail |
| `POST` | `/api/admin/run-deadline-check`| Super Admin | Trigger idempotent deadline and escalation engine |
| `GET` | `/api/reports/summary` | Officers, Authority, Admin | Pendency, ageing, and stage backlog metrics |
| `GET` | `/api/reports/applications.csv`| Officers, Admin | Export CSV report of visible applications |
| `GET` | `/api/audit` | Officers, Authority, Admin | Immutable audit event trail |

---

## 7. Compliance Disclaimer

This software product was developed for **AICTE Problem Statement ID 26262**. It uses synthetic demonstration data and explicitly configurable demonstration rules. It does not interface with official production AICTE databases or replace statutory scrutiny, expert inspections, document verification, or decisions reserved for competent AICTE authorities.
