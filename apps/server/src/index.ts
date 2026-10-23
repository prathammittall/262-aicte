import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { db } from './prisma/db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SECRET = process.env.APP_SECRET || 'local-demo-only-change-before-deployment';
const UPLOAD_DIR = path.resolve(__dirname, '../private_uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Multer memory storage for signature and size verification
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

const allowedOrigins = [
  'http://localhost:3001',
  'http://localhost:3000',
  process.env.FRONTEND_ORIGIN || 'http://localhost:3001',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // Allow demo cross-origin
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
}));

app.use(cookieParser());
app.use(express.json());

app.get("/", (req, res)=>{
  res.send("Server started...")
})

// Helper date utilities
function nowUtc(): Date {
  return new Date();
}

function iso(d: Date = new Date()): string {
  return d.toISOString();
}

// Password hashing compatible with Python PBKDF2 format
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const digest = crypto.pbkdf2Sync(password, salt, 240000, 32, 'sha256');
  return `${salt.toString('base64url')}:${digest.toString('base64url')}`;
}

function verifyPassword(password: string, encoded: string): boolean {
  try {
    const [saltText, digestText] = encoded.split(':');
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(digestText, 'base64url');
    const actual = crypto.pbkdf2Sync(password, salt, 240000, 32, 'sha256');
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Session tokens
function createToken(userId: string): string {
  const expires = Math.floor(Date.now() / 1000) + 8 * 3600;
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: expires })).toString('base64url');
  const signature = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

async function verifyToken(token: string): Promise<any> {
  try {
    const [payload, signature] = token.split('.');
    const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
    if (signature !== expected) throw new Error('Bad signature');
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.exp < Math.floor(Date.now() / 1000)) throw new Error('Expired');
    const user = await db.orm.public.User.where({ id: data.sub }).first();
    if (!user) throw new Error('User not found');
    return user;
  } catch {
    return null;
  }
}

// Current User middleware
async function currentUserMiddleware(req: Request, res: Response, next: NextFunction) {
  let token = req.cookies?.aicte_session;
  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7);
  }
  if (!token) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const user = await verifyToken(token);
  if (!user) {
    res.status(401).json({ detail: 'Invalid or expired session' });
    return;
  }
  (req as any).user = user;
  next();
}

function requireRoles(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user || !roles.includes(user.role)) {
      res.status(403).json({ detail: 'This action is not permitted for your role' });
      return;
    }
    next();
  };
}

// Audit helper
async function audit(
  actor: string,
  action: string,
  entityType: string,
  entityId: string,
  reason = '',
  previous: any = null,
  newState: any = null,
) {
  try {
    await db.orm.public.AuditEvent.create({
      id: crypto.randomUUID(),
      actorId: actor,
      action,
      entityType,
      entityId,
      reason,
      previousState: previous !== null ? JSON.stringify(previous) : null,
      newState: newState !== null ? JSON.stringify(newState) : null,
      createdAt: iso(),
    });
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

// Visible application check
function visibleApplication(user: any, appRow: any, institutionsMap: Map<string, any>): boolean {
  if (user.role === 'institution') {
    return appRow.institutionId === user.institutionId;
  }
  if (user.role === 'regional_officer') {
    const inst = institutionsMap.get(appRow.institutionId);
    return Boolean(inst && inst.region === user.regionId);
  }
  if (['scrutiny_officer', 'evc_member'].includes(user.role)) {
    const inst = institutionsMap.get(appRow.institutionId);
    return appRow.assignedTo === user.id || Boolean(inst && inst.region === user.regionId);
  }
  return ['super_admin', 'central_officer', 'competent_authority'].includes(user.role);
}

function serializeApplication(appRow: any, instMap: Map<string, any>, usersMap: Map<string, any>) {
  const inst = instMap.get(appRow.institutionId);
  const assignee = appRow.assignedTo ? usersMap.get(appRow.assignedTo) : null;
  return {
    id: appRow.id,
    institution_id: appRow.institutionId,
    reference: appRow.reference,
    application_type: appRow.applicationType,
    cycle: appRow.cycle,
    stage: appRow.stage,
    status: appRow.status,
    submitted_at: appRow.submittedAt,
    due_at: appRow.dueAt,
    assigned_to: appRow.assignedTo,
    workflow_version: appRow.workflowVersion,
    summary: appRow.summary,
    updated_at: appRow.updatedAt,
    workflow_version_id: appRow.workflowVersionId,
    return_to_stage: appRow.returnToStage,
    decision_notes: appRow.decisionNotes || null,
    decision_at: appRow.decisionAt || null,
    institution_name: inst ? inst.name : 'Unknown institution',
    region: inst ? inst.region : null,
    assignee: assignee ? assignee.name : 'Unassigned',
  };
}

// Database Seeder
async function seed() {
  try {
    const demoUsers = [
      { id: 'u-admin', name: 'Aarav Mehta', email: 'admin@demo.aicte.local', role: 'super_admin', regionId: null, institutionId: null },
      { id: 'u-central', name: 'Kavya Rao', email: 'central@demo.aicte.local', role: 'central_officer', regionId: null, institutionId: null },
      { id: 'u-authority', name: 'Dr. Vikram Malhotra', email: 'authority@demo.aicte.local', role: 'competent_authority', regionId: null, institutionId: null },
      { id: 'u-bureau', name: 'Sanjay Deshmukh', email: 'bureau@demo.aicte.local', role: 'central_officer', regionId: null, institutionId: null },
      { id: 'u-north', name: 'Rohan Verma', email: 'north@demo.aicte.local', role: 'regional_officer', regionId: 'Northern Region', institutionId: null },
      { id: 'u-scrutiny', name: 'Isha Nair', email: 'scrutiny@demo.aicte.local', role: 'scrutiny_officer', regionId: 'Northern Region', institutionId: null },
      { id: 'u-scrutiny-west', name: 'Mira Desai', email: 'west.scrutiny@demo.aicte.local', role: 'scrutiny_officer', regionId: 'Western Region', institutionId: null },
      { id: 'u-evc', name: 'Dev Patel', email: 'evc@demo.aicte.local', role: 'evc_member', regionId: 'Northern Region', institutionId: null },
      { id: 'u-inst', name: 'Ananya Sharma', email: 'institution@demo.aicte.local', role: 'institution', regionId: null, institutionId: 'inst-001' },
    ];
    const passwordHash = hashPassword('DemoPass!2026');
    for (const u of demoUsers) {
      const existing = await db.orm.public.User.where({ email: u.email }).first();
      if (!existing) {
        await db.orm.public.User.create({
          id: u.id,
          name: u.name,
          email: u.email,
          passwordHash,
          role: u.role,
          regionId: u.regionId,
          institutionId: u.institutionId,
        });
      }
    }
    const existingInsts = await db.orm.public.Institution.all();
    if (existingInsts.length === 0) {
      const insts = [
        { id: 'inst-001', name: 'North Valley Institute of Technology', code: 'NVI-2048', region: 'Northern Region', city: 'Dehradun', status: 'Active' },
        { id: 'inst-002', name: 'Saraswati College of Engineering', code: 'SCE-1192', region: 'Northern Region', city: 'Jaipur', status: 'Active' },
        { id: 'inst-003', name: 'Coastal School of Applied Sciences', code: 'CSA-3864', region: 'Western Region', city: 'Pune', status: 'Active' },
      ];

      for (const inst of insts) {
        await db.orm.public.Institution.create(inst);
      }

      // Workflow templates & versions
      const wfTemplates = [
        { id: 'workflow-evc', name: 'Scrutiny, EVC and committee', description: 'Demonstration route with an expert visit and committee review.', activeVersionId: 'wf-evc-v1' },
        { id: 'workflow-standard', name: 'Scrutiny and committee', description: 'Demonstration route without an EVC stage.', activeVersionId: 'wf-standard-v1' },
        { id: 'workflow-direct', name: 'Scrutiny only', description: 'Demonstration route with direct completion after scrutiny.', activeVersionId: 'wf-direct-v1' },
      ];
      for (const wt of wfTemplates) {
        await db.orm.public.WorkflowTemplate.create(wt);
      }

      const wfVersions = [
        { id: 'wf-evc-v1', templateId: 'workflow-evc', version: 1, stagesJson: JSON.stringify(['Scrutiny', 'EVC', 'Committee review', 'Completed']), status: 'Published', createdBy: 'u-admin', createdAt: '2026-01-01T00:00:00.000Z', publishedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'wf-standard-v1', templateId: 'workflow-standard', version: 1, stagesJson: JSON.stringify(['Scrutiny', 'Committee review', 'Completed']), status: 'Published', createdBy: 'u-admin', createdAt: '2026-01-01T00:00:00.000Z', publishedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'wf-direct-v1', templateId: 'workflow-direct', version: 1, stagesJson: JSON.stringify(['Scrutiny', 'Completed']), status: 'Published', createdBy: 'u-admin', createdAt: '2026-01-01T00:00:00.000Z', publishedAt: '2026-01-01T00:00:00.000Z' },
      ];
      for (const wv of wfVersions) {
        await db.orm.public.WorkflowVersion.create(wv);
      }

      const today = nowUtc();
      const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86400000);

      const applications = [
        { id: 'app-001', institutionId: 'inst-001', reference: 'AICTE/2026/NVI/0142', applicationType: 'Extension of Approval', cycle: '2026-27', stage: 'Scrutiny', status: 'In review', submittedAt: iso(addDays(today, -2)), dueAt: iso(addDays(today, 3)), assignedTo: 'u-scrutiny', workflowVersion: 1, summary: 'Renewal package submitted; land lease evidence requires review.', updatedAt: iso(), workflowVersionId: 'wf-evc-v1', returnToStage: null },
        { id: 'app-002', institutionId: 'inst-002', reference: 'AICTE/2026/SCE/0098', applicationType: 'New Institution', cycle: '2026-27', stage: 'EVC', status: 'Scheduled', submittedAt: iso(addDays(today, -8)), dueAt: iso(addDays(today, 5)), assignedTo: 'u-evc', workflowVersion: 1, summary: 'Initial application passed document screening.', updatedAt: iso(), workflowVersionId: 'wf-evc-v1', returnToStage: null },
        { id: 'app-003', institutionId: 'inst-001', reference: 'AICTE/2026/NVI/0117', applicationType: 'Increase in Intake', cycle: '2026-27', stage: 'Correction', status: 'Returned', submittedAt: iso(addDays(today, -14)), dueAt: iso(addDays(today, -1)), assignedTo: 'u-scrutiny', workflowVersion: 1, summary: 'Clarification requested on faculty appointment records.', updatedAt: iso(), workflowVersionId: 'wf-evc-v1', returnToStage: 'Scrutiny' },
        { id: 'app-004', institutionId: 'inst-003', reference: 'AICTE/2026/CSA/0221', applicationType: 'Extension of Approval', cycle: '2026-27', stage: 'Committee review', status: 'Pending', submittedAt: iso(addDays(today, -20)), dueAt: iso(addDays(today, 9)), assignedTo: 'u-central', workflowVersion: 1, summary: 'Expert visit report received; committee recommendation pending.', updatedAt: iso(), workflowVersionId: 'wf-standard-v1', returnToStage: null },
        { id: 'app-005', institutionId: 'inst-001', reference: 'AICTE/2026/NVI/0196', applicationType: 'New Programme', cycle: '2026-27', stage: 'Completed', status: 'Completed', submittedAt: iso(addDays(today, -25)), dueAt: iso(addDays(today, -3)), assignedTo: 'u-central', workflowVersion: 1, summary: 'Application completed in demonstration workflow.', updatedAt: iso(), workflowVersionId: 'wf-direct-v1', returnToStage: null },
      ];
      for (const a of applications) {
        await db.orm.public.Application.create(a);
      }

      const obligations = [
        { id: 'obl-001', institutionId: 'inst-001', applicationId: 'app-001', title: 'Submit updated land lease deed', dueAt: iso(addDays(today, 4)), status: 'Awaiting submission', assignedTo: 'u-north', submittedAt: null, evidenceName: null, updatedAt: iso() },
        { id: 'obl-002', institutionId: 'inst-001', applicationId: 'app-003', title: 'Faculty qualification evidence', dueAt: iso(addDays(today, -2)), status: 'Overdue', assignedTo: 'u-scrutiny', submittedAt: null, evidenceName: null, updatedAt: iso() },
        { id: 'obl-003', institutionId: 'inst-002', applicationId: 'app-002', title: 'Upload fire safety certificate', dueAt: iso(addDays(today, 12)), status: 'Under verification', assignedTo: 'u-north', submittedAt: null, evidenceName: null, updatedAt: iso() },
        { id: 'obl-004', institutionId: 'inst-003', applicationId: 'app-004', title: 'Annual compliance undertaking', dueAt: iso(addDays(today, 24)), status: 'Upcoming', assignedTo: 'u-central', submittedAt: null, evidenceName: null, updatedAt: iso() },
      ];
      for (const o of obligations) {
        await db.orm.public.ComplianceObligation.create(o);
      }

      // Initial Stage Events
      for (const a of applications) {
        await db.orm.public.StageEvent.create({
          id: crypto.randomUUID(),
          applicationId: a.id,
          fromStage: null,
          toStage: a.stage,
          action: 'Initial submission',
          reason: 'Application registered in demo system',
          actorId: 'u-admin',
          createdAt: a.submittedAt,
        });
      }

      console.log('Seeding completed successfully.');
    }
  } catch (err) {
    console.error('Seeding error:', err);
  }
}

// ------------------- API ROUTES ------------------- //

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'server', port: PORT });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', mode: 'synthetic-demo' });
});

// Auth
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ detail: 'Email and password required' });
      return;
    }
    const cleanEmail = String(email).toLowerCase().trim();
    const user = await db.orm.public.User.where({ email: cleanEmail }).first();
    if (!user || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ detail: 'Email or password is incorrect' });
      return;
    }

    const token = createToken(user.id);
    const isSecure = process.env.SECURE_COOKIE?.toLowerCase() === 'true';

    res.cookie('aicte_session', token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000,
      path: '/',
    });

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        region_id: user.regionId,
        institution_id: user.institutionId,
      },
    });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('aicte_session', { path: '/' });
  res.json({ status: 'signed out' });
});

app.post('/api/auth/demo-switch', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ detail: 'Email is required' });
      return;
    }
    const cleanEmail = String(email).toLowerCase().trim();
    const user = await db.orm.public.User.where({ email: cleanEmail }).first();
    if (!user) {
      res.status(404).json({ detail: `Demo account '${cleanEmail}' not found` });
      return;
    }

    const token = createToken(user.id);
    const isSecure = process.env.SECURE_COOKIE?.toLowerCase() === 'true';

    res.cookie('aicte_session', token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000,
      path: '/',
    });

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        region_id: user.regionId,
        institution_id: user.institutionId,
      },
    });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

app.get('/api/auth/me', currentUserMiddleware, (req, res) => {
  const user = (req as any).user;
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    region_id: user.regionId,
    institution_id: user.institutionId,
  });
});

// Dashboard
app.get('/api/dashboard', currentUserMiddleware, async (req, res) => {
  try {
    const user = (req as any).user;
    const [allApps, allInsts, allUsers] = await Promise.all([
      db.orm.public.Application.all(),
      db.orm.public.Institution.all(),
      db.orm.public.User.all(),
    ]);

    const instMap = new Map(allInsts.map((i: any) => [i.id, i]));
    const userMap = new Map(allUsers.map((u: any) => [u.id, u]));

    const visibleApps = allApps
      .filter((a: any) => visibleApplication(user, a, instMap))
      .sort((a: any, b: any) => b.submittedAt.localeCompare(a.submittedAt))
      .map((a: any) => serializeApplication(a, instMap, userMap));

    let [allObligations, allDocs] = await Promise.all([
      db.orm.public.ComplianceObligation.all(),
      db.orm.public.InstitutionalDocument.all(),
    ]);

    if (user.role === 'institution') {
      allObligations = allObligations.filter((o: any) => o.institutionId === user.institutionId);
      allDocs = allDocs.filter((d: any) => d.institutionId === user.institutionId);
    } else if (user.role === 'regional_officer') {
      const regionInstIds = new Set(allInsts.filter((i: any) => i.region === user.regionId).map((i: any) => i.id));
      allObligations = allObligations.filter((o: any) => regionInstIds.has(o.institutionId));
      allDocs = allDocs.filter((d: any) => regionInstIds.has(d.institutionId));
    } else if (['scrutiny_officer', 'evc_member'].includes(user.role)) {
      const assignedInstIds = new Set(allApps.filter((a: any) => a.assignedTo === user.id).map((a: any) => a.institutionId));
      allObligations = allObligations.filter((o: any) => assignedInstIds.has(o.institutionId));
      allDocs = allDocs.filter((d: any) => assignedInstIds.has(d.institutionId));
    }

    const stages: Record<string, number> = {};
    for (const item of visibleApps) {
      stages[item.stage] = (stages[item.stage] || 0) + 1;
    }

    const now = nowUtc();
    const in90Days = new Date(now.getTime() + 90 * 86400000);
    const in7Days = new Date(now.getTime() + 7 * 86400000);

    const expiring = allDocs.filter((d: any) => {
      if (!d.expiresAt) return false;
      const exp = new Date(d.expiresAt);
      return exp >= now && exp <= in90Days;
    }).length;

    const overdue = visibleApps.filter((a: any) => {
      return a.stage !== 'Completed' && new Date(a.due_at) < now;
    }).length;

    const obligationsDueSoon = allObligations.filter((o: any) => {
      const due = new Date(o.dueAt);
      return due >= now && due <= in7Days;
    }).length;

    res.json({
      refreshed_at: iso(),
      counts: {
        total_applications: visibleApps.length,
        in_progress: visibleApps.filter((a: any) => a.stage !== 'Completed').length,
        awaiting_scrutiny: stages['Scrutiny'] || 0,
        awaiting_evc: stages['EVC'] || 0,
        returned: stages['Correction'] || 0,
        overdue,
        obligations_due_soon: obligationsDueSoon,
        documents_expiring: expiring,
      },
      stage_distribution: Object.entries(stages).map(([stage, count]) => ({ stage, count })),
      applications: visibleApps.slice(0, 5),
    });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Applications list
app.get('/api/applications', currentUserMiddleware, async (req, res) => {
  try {
    const user = (req as any).user;
    const { q = '', stage = '' } = req.query as { q?: string; stage?: string };

    const [allApps, allInsts, allUsers] = await Promise.all([
      db.orm.public.Application.all(),
      db.orm.public.Institution.all(),
      db.orm.public.User.all(),
    ]);

    const instMap = new Map(allInsts.map((i: any) => [i.id, i]));
    const userMap = new Map(allUsers.map((u: any) => [u.id, u]));

    let result = allApps
      .filter((a: any) => visibleApplication(user, a, instMap))
      .sort((a: any, b: any) => b.submittedAt.localeCompare(a.submittedAt))
      .map((a: any) => serializeApplication(a, instMap, userMap));

    if (stage) {
      result = result.filter((a: any) => a.stage.toLowerCase() === stage.toLowerCase());
    }
    if (q) {
      const queryText = q.toLowerCase();
      result = result.filter((a: any) =>
        a.reference.toLowerCase().includes(queryText) ||
        a.institution_name.toLowerCase().includes(queryText)
      );
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Create Application
app.post('/api/applications', currentUserMiddleware, requireRoles('super_admin', 'central_officer', 'regional_officer', 'institution'), async (req, res) => {
  try {
    const user = (req as any).user;
    const { institution_id, application_type, cycle, workflow_version_id, summary = '' } = req.body;

    const inst = await db.orm.public.Institution.where({ id: institution_id }).first();
    if (!inst || (user.role === 'institution' && user.institutionId !== institution_id)) {
      res.status(404).json({ detail: 'Institution not found in your authorised scope' });
      return;
    }
    if (user.role === 'regional_officer' && inst.region !== user.regionId) {
      res.status(403).json({ detail: 'Institution is outside your region' });
      return;
    }

    const allUsers = await db.orm.public.User.all();
    let assignee = allUsers.find((u: any) => u.role === 'scrutiny_officer' && u.regionId === inst.region);
    if (!assignee) {
      assignee = allUsers.find((u: any) => u.role === 'regional_officer' && u.regionId === inst.region);
    }
    if (!assignee) {
      assignee = allUsers.find((u: any) => u.role === 'central_officer');
    }
    if (!assignee) {
      res.status(409).json({ detail: 'No authorised initial assignee is configured' });
      return;
    }

    const workflow = await db.orm.public.WorkflowVersion.where({ id: workflow_version_id }).first();
    if (!workflow || workflow.status !== 'Published') {
      res.status(422).json({ detail: 'Select a currently published workflow route' });
      return;
    }

    const ident = crypto.randomUUID();
    const reference = `AICTE/DEMO/${new Date().getFullYear()}/${ident.slice(0, 8).toUpperCase()}`;
    const deadline = iso(new Date(Date.now() + 15 * 86400000));
    const nowStr = iso();

    await db.orm.public.Application.create({
      id: ident,
      institutionId: institution_id,
      reference,
      applicationType: application_type,
      cycle,
      stage: 'Scrutiny',
      status: 'In review',
      submittedAt: nowStr,
      dueAt: deadline,
      assignedTo: assignee.id,
      workflowVersion: workflow.version,
      summary,
      updatedAt: nowStr,
      workflowVersionId: workflow.id,
      returnToStage: null,
    });

    await db.orm.public.StageEvent.create({
      id: crypto.randomUUID(),
      applicationId: ident,
      fromStage: null,
      toStage: 'Scrutiny',
      action: 'Application submitted',
      reason: 'Initial submission',
      actorId: user.id,
      createdAt: nowStr,
    });

    await audit(user.id, 'Application created', 'application', ident, 'New synthetic demo submission', null, { reference, stage: 'Scrutiny' });

    const newApp = await db.orm.public.Application.where({ id: ident }).first();
    const instMap = new Map([[inst.id, inst]]);
    const userMap = new Map([[assignee.id, assignee]]);

    res.status(201).json(serializeApplication(newApp, instMap, userMap));
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Application Transition
const ACTION_ROLES: Record<string, string[]> = {
  return: ['scrutiny_officer', 'regional_officer', 'central_officer', 'super_admin'],
  resubmit: ['institution'],
};
const COMPLETE_ROLES_BY_STAGE: Record<string, string[]> = {
  Scrutiny: ['scrutiny_officer', 'regional_officer', 'central_officer', 'super_admin'],
  EVC: ['evc_member', 'central_officer', 'regional_officer', 'super_admin'],
  'Committee review': ['central_officer', 'competent_authority', 'super_admin'],
};

app.post('/api/applications/:applicationId/transition', currentUserMiddleware, async (req, res) => {
  try {
    const user = (req as any).user;
    const applicationId = String(req.params.applicationId);
    const { action, reason } = req.body;

    const row = await db.orm.public.Application.where({ id: applicationId }).first();
    const inst = row ? await db.orm.public.Institution.where({ id: row.institutionId }).first() : null;
    const instMap = new Map(inst ? [[inst.id, inst]] : []);

    if (!row || !visibleApplication(user, row, instMap)) {
      res.status(404).json({ detail: 'Application not found' });
      return;
    }

    if (action === 'complete') {
      const allowedRoles = COMPLETE_ROLES_BY_STAGE[row.stage];
      if (!allowedRoles) {
        res.status(409).json({ detail: `Application cannot advance from stage '${row.stage}'` });
        return;
      }
      if (!allowedRoles.includes(user.role)) {
        res.status(403).json({ detail: 'This action is not permitted for your role at this stage' });
        return;
      }
    } else {
      const allowedRoles = ACTION_ROLES[action];
      if (!allowedRoles || !allowedRoles.includes(user.role)) {
        res.status(403).json({ detail: 'This action is not permitted for your role' });
        return;
      }
    }

    const version = await db.orm.public.WorkflowVersion.where({ id: row.workflowVersionId }).first();
    if (!version) {
      res.status(409).json({ detail: 'Application has no valid retained workflow version' });
      return;
    }

    const stages: string[] = JSON.parse(version.stagesJson);
    let nextStage = row.stage;
    let nextStatus = row.status;
    let returnToStage = row.returnToStage;

    if (action === 'return') {
      if (row.stage !== 'Scrutiny') {
        res.status(409).json({ detail: 'Only scrutiny-stage applications can be returned' });
        return;
      }
      nextStage = 'Correction';
      nextStatus = 'Returned';
      returnToStage = row.stage;
    } else if (action === 'resubmit') {
      if (row.stage !== 'Correction') {
        res.status(409).json({ detail: 'Only returned applications can be resubmitted' });
        return;
      }
      if (row.institutionId !== user.institutionId) {
        res.status(403).json({ detail: 'Only the owning institution may resubmit this application' });
        return;
      }
      nextStage = (returnToStage && stages.includes(returnToStage)) ? returnToStage : stages[0];
      nextStatus = 'Resubmitted';
      returnToStage = null;
    } else if (action === 'complete') {
      const idx = stages.indexOf(row.stage);
      if (idx === -1 || idx >= stages.length - 1) {
        res.status(409).json({ detail: `Application cannot advance from stage '${row.stage}'` });
        return;
      }
      nextStage = stages[idx + 1];
      nextStatus = nextStage === 'Completed' ? 'Completed' : 'Pending';
    } else {
      res.status(422).json({ detail: 'Unsupported workflow action' });
      return;
    }

    const oldState = { stage: row.stage, status: row.status };
    const nowStr = iso();

    await db.orm.public.Application.where({ id: applicationId }).update({
      stage: nextStage,
      status: nextStatus,
      returnToStage,
      updatedAt: nowStr,
    });

    await db.orm.public.StageEvent.create({
      id: crypto.randomUUID(),
      applicationId,
      fromStage: row.stage,
      toStage: nextStage,
      action,
      reason,
      actorId: user.id,
      createdAt: nowStr,
    });

    await audit(user.id, action, 'application', applicationId, reason, oldState, { stage: nextStage, status: nextStatus });

    const updated = await db.orm.public.Application.where({ id: applicationId }).first();
    const allUsers = await db.orm.public.User.all();
    const userMap = new Map(allUsers.map((u: any) => [u.id, u]));

    res.json(serializeApplication(updated, instMap, userMap));
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Timeline
app.get('/api/applications/:applicationId/timeline', currentUserMiddleware, async (req, res) => {
  try {
    const user = (req as any).user;
    const applicationId = String(req.params.applicationId);

    const row = await db.orm.public.Application.where({ id: applicationId }).first();
    const inst = row ? await db.orm.public.Institution.where({ id: row.institutionId }).first() : null;
    const instMap = new Map(inst ? [[inst.id, inst]] : []);

    if (!row || !visibleApplication(user, row, instMap)) {
      res.status(404).json({ detail: 'Application not found' });
      return;
    }

    const [events, allUsers] = await Promise.all([
      db.orm.public.StageEvent.all(),
      db.orm.public.User.all(),
    ]);

    const userMap = new Map(allUsers.map((u: any) => [u.id, u]));

    const result = events
      .filter((e: any) => e.applicationId === applicationId)
      .sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt))
      .map((e: any) => ({
        id: e.id,
        application_id: e.applicationId,
        from_stage: e.fromStage,
        to_stage: e.toStage,
        action: e.action,
        reason: e.reason,
        actor_id: e.actorId,
        actor: userMap.get(e.actorId)?.name || 'Unknown',
        created_at: e.createdAt,
      }));

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Scrutiny Observations
app.get('/api/applications/:applicationId/scrutiny', currentUserMiddleware, async (req, res) => {
  try {
    const user = (req as any).user;
    const applicationId = String(req.params.applicationId);
    const row = await db.orm.public.Application.where({ id: applicationId }).first();
    const inst = row ? await db.orm.public.Institution.where({ id: row.institutionId }).first() : null;
    const instMap = new Map(inst ? [[inst.id, inst]] : []);

    if (!row || !visibleApplication(user, row, instMap)) {
      res.status(404).json({ detail: 'Application not found' });
      return;
    }

    const [observations, allUsers] = await Promise.all([
      db.orm.public.ScrutinyObservation.all(),
      db.orm.public.User.all(),
    ]);

    const userMap = new Map(allUsers.map((u: any) => [u.id, u]));

    const result = observations
      .filter((o: any) => o.applicationId === applicationId)
      .sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt))
      .map((o: any) => ({
        id: o.id,
        application_id: o.applicationId,
        category: o.category,
        finding: o.finding,
        status: o.status,
        officer_id: o.officerId,
        officer_name: userMap.get(o.officerId)?.name || 'Scrutiny Officer',
        created_at: o.createdAt,
      }));

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

app.post('/api/applications/:applicationId/scrutiny', currentUserMiddleware, requireRoles('scrutiny_officer', 'regional_officer', 'central_officer', 'super_admin'), async (req, res) => {
  try {
    const user = (req as any).user;
    const applicationId = String(req.params.applicationId);
    const { category, finding, status } = req.body;

    if (!category || !finding || !status) {
      res.status(422).json({ detail: 'Category, finding observation, and status are required' });
      return;
    }

    const row = await db.orm.public.Application.where({ id: applicationId }).first();
    if (!row) {
      res.status(404).json({ detail: 'Application not found' });
      return;
    }

    const ident = crypto.randomUUID();
    const nowStr = iso();

    await db.orm.public.ScrutinyObservation.create({
      id: ident,
      applicationId,
      category,
      finding,
      status, // 'Satisfactory' | 'Deficient'
      officerId: user.id,
      createdAt: nowStr,
    });

    await audit(user.id, 'Scrutiny observation recorded', 'application', applicationId, finding, null, { category, status });

    res.status(201).json({ id: ident, status: 'Observation recorded' });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Competent Authority Statutory Decision
app.post('/api/applications/:applicationId/decision', currentUserMiddleware, requireRoles('competent_authority', 'central_officer', 'super_admin'), async (req, res) => {
  try {
    const user = (req as any).user;
    const applicationId = String(req.params.applicationId);
    const { decision, reason, undertakings = [] } = req.body;

    if (!decision || !reason) {
      res.status(422).json({ detail: 'Decision and formal reasoning are mandatory' });
      return;
    }

    const row = await db.orm.public.Application.where({ id: applicationId }).first();
    if (!row) {
      res.status(404).json({ detail: 'Application not found' });
      return;
    }

    const nowStr = iso();
    let nextStatus = 'Approved';
    if (decision === 'approve_with_undertaking') {
      nextStatus = 'Approved (Conditional)';
    } else if (decision === 'reject') {
      nextStatus = 'Rejected';
    } else if (decision === 'approve') {
      nextStatus = 'Approved';
    } else {
      res.status(422).json({ detail: 'Unsupported decision type' });
      return;
    }

    const oldState = { stage: row.stage, status: row.status };

    await db.orm.public.Application.where({ id: applicationId }).update({
      stage: 'Completed',
      status: nextStatus,
      decisionNotes: reason,
      decisionAt: nowStr,
      updatedAt: nowStr,
    });

    // If conditional undertakings were specified, create them
    if (decision === 'approve_with_undertaking' && Array.isArray(undertakings)) {
      const today = nowUtc();
      const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86400000);
      for (const item of undertakings) {
        if (item.title) {
          const dueDays = Number(item.due_in_days) || 30;
          await db.orm.public.ComplianceObligation.create({
            id: crypto.randomUUID(),
            institutionId: row.institutionId,
            applicationId: row.id,
            title: item.title,
            dueAt: iso(addDays(today, dueDays)),
            status: 'Awaiting submission',
            assignedTo: user.id,
            submittedAt: null,
            evidenceName: null,
            updatedAt: nowStr,
            notes: `Mandated condition of approval order: ${reason}`,
          });
        }
      }
    }

    await db.orm.public.StageEvent.create({
      id: crypto.randomUUID(),
      applicationId,
      fromStage: row.stage,
      toStage: 'Completed',
      action: `Statutory Decision: ${nextStatus}`,
      reason,
      actorId: user.id,
      createdAt: nowStr,
    });

    await audit(user.id, `Statutory decision: ${nextStatus}`, 'application', applicationId, reason, oldState, { stage: 'Completed', status: nextStatus, decisionNotes: reason });

    const updated = await db.orm.public.Application.where({ id: applicationId }).first();
    const [allInsts, allUsers] = await Promise.all([
      db.orm.public.Institution.all(),
      db.orm.public.User.all(),
    ]);
    const instMap = new Map(allInsts.map((i: any) => [i.id, i]));
    const userMap = new Map(allUsers.map((u: any) => [u.id, u]));

    res.json(serializeApplication(updated, instMap, userMap));
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});


// Workflows
app.get('/api/workflows/templates', currentUserMiddleware, async (_req, res) => {
  try {
    const [templates, versions] = await Promise.all([
      db.orm.public.WorkflowTemplate.all(),
      db.orm.public.WorkflowVersion.all(),
    ]);

    const versionMap = new Map(versions.map((v: any) => [v.id, v]));

    const result = templates
      .map((t: any) => {
        const active = t.activeVersionId ? versionMap.get(t.activeVersionId) : null;
        if (!active || active.status !== 'Published') return null;
        return {
          template_id: t.id,
          name: t.name,
          description: t.description,
          workflow_version_id: active.id,
          version: active.version,
          stages: JSON.parse(active.stagesJson),
        };
      })
      .filter(Boolean);

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

app.get('/api/workflows', currentUserMiddleware, requireRoles('super_admin'), async (_req, res) => {
  try {
    const [versions, templates] = await Promise.all([
      db.orm.public.WorkflowVersion.all(),
      db.orm.public.WorkflowTemplate.all(),
    ]);

    const templateMap = new Map(templates.map((t: any) => [t.id, t]));

    const result = versions
      .sort((a: any, b: any) => b.version - a.version)
      .map((v: any) => {
        const t = templateMap.get(v.templateId);
        return {
          id: v.id,
          template_id: v.templateId,
          template_name: t?.name || 'Unknown',
          version: v.version,
          status: v.status,
          stages: JSON.parse(v.stagesJson),
          active_version_id: t?.activeVersionId || null,
          created_at: v.createdAt,
          published_at: v.publishedAt,
        };
      });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

app.post('/api/workflows/:templateId/versions', currentUserMiddleware, requireRoles('super_admin'), async (req, res) => {
  try {
    const user = (req as any).user;
    const templateId = String(req.params.templateId);
    const { stages } = req.body;

    const allowed = ['Scrutiny', 'EVC', 'Committee review', 'Completed'];
    if (!Array.isArray(stages) || stages.length < 2 || stages.length > 4) {
      res.status(422).json({ detail: 'Stages must contain between 2 and 4 elements' });
      return;
    }
    if (stages[0] !== 'Scrutiny' || stages[stages.length - 1] !== 'Completed') {
      res.status(422).json({ detail: 'A route must begin with Scrutiny and end with Completed' });
      return;
    }
    if (new Set(stages).size !== stages.length || stages.some((s: string) => !allowed.includes(s))) {
      res.status(422).json({ detail: 'Route contains duplicate or unsupported stages' });
      return;
    }
    const expectedOrder = allowed.filter(s => stages.includes(s));
    if (JSON.stringify(stages) !== JSON.stringify(expectedOrder)) {
      res.status(422).json({ detail: 'Stages must follow the supported configured order' });
      return;
    }

    const template = await db.orm.public.WorkflowTemplate.where({ id: templateId }).first();
    if (!template) {
      res.status(404).json({ detail: 'Workflow template not found' });
      return;
    }

    const allVersions = await db.orm.public.WorkflowVersion.all();
    const templateVersions = allVersions.filter((v: any) => v.templateId === templateId);
    const maxVersion = templateVersions.reduce((max: number, v: any) => Math.max(max, v.version), 0);
    const newVersionNum = maxVersion + 1;

    const ident = crypto.randomUUID();
    const created = iso();

    await db.orm.public.WorkflowVersion.create({
      id: ident,
      templateId,
      version: newVersionNum,
      stagesJson: JSON.stringify(stages),
      status: 'Draft',
      createdBy: user.id,
      createdAt: created,
      publishedAt: null,
    });

    await audit(user.id, 'Workflow version drafted', 'workflow_version', ident, 'Administrator created a validated draft route', null, { version: newVersionNum, stages });

    res.status(201).json({
      id: ident,
      template_id: templateId,
      template_name: template.name,
      version: newVersionNum,
      stages,
      status: 'Draft',
      created_at: created,
    });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

app.post('/api/workflow-versions/:versionId/publish', currentUserMiddleware, requireRoles('super_admin'), async (req, res) => {
  try {
    const user = (req as any).user;
    const versionId = String(req.params.versionId);

    const row = await db.orm.public.WorkflowVersion.where({ id: versionId }).first();
    if (!row) {
      res.status(404).json({ detail: 'Workflow version not found' });
      return;
    }
    if (row.status !== 'Draft') {
      res.status(409).json({ detail: 'Only a draft workflow version can be published' });
      return;
    }

    const stages = JSON.parse(row.stagesJson);
    if (stages[0] !== 'Scrutiny' || stages[stages.length - 1] !== 'Completed') {
      res.status(422).json({ detail: 'Workflow validation failed' });
      return;
    }

    const template = await db.orm.public.WorkflowTemplate.where({ id: row.templateId }).first();
    const oldActiveId = template?.activeVersionId;
    const published = iso();

    if (oldActiveId) {
      await db.orm.public.WorkflowVersion.where({ id: oldActiveId }).update({
        status: 'Superseded',
      });
    }

    await db.orm.public.WorkflowVersion.where({ id: versionId }).update({
      status: 'Published',
      publishedAt: published,
    });

    await db.orm.public.WorkflowTemplate.where({ id: row.templateId }).update({
      activeVersionId: versionId,
    });

    await audit(
      user.id,
      'Workflow version published',
      'workflow_version',
      versionId,
      'Validated draft published for new applications',
      { active_version_id: oldActiveId },
      { active_version_id: versionId, stages }
    );

    res.json({
      id: versionId,
      version: row.version,
      status: 'Published',
      published_at: published,
      stages,
    });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Compliance
app.get('/api/compliance', currentUserMiddleware, async (req, res) => {
  try {
    const user = (req as any).user;
    const [allObligations, allInsts, allApps] = await Promise.all([
      db.orm.public.ComplianceObligation.all(),
      db.orm.public.Institution.all(),
      db.orm.public.Application.all(),
    ]);

    const instMap = new Map(allInsts.map((i: any) => [i.id, i]));
    let rows = allObligations;

    if (user.role === 'institution') {
      rows = rows.filter((o: any) => o.institutionId === user.institutionId);
    } else if (user.role === 'regional_officer') {
      rows = rows.filter((o: any) => instMap.get(o.institutionId)?.region === user.regionId);
    } else if (['scrutiny_officer', 'evc_member'].includes(user.role)) {
      const assignedInstIds = new Set(allApps.filter((a: any) => a.assignedTo === user.id).map((a: any) => a.institutionId));
      rows = rows.filter((o: any) => assignedInstIds.has(o.institutionId));
    }

    const result = rows
      .sort((a: any, b: any) => a.dueAt.localeCompare(b.dueAt))
      .map((o: any) => {
        const inst = instMap.get(o.institutionId);
        return {
          id: o.id,
          institution_id: o.institutionId,
          application_id: o.applicationId,
          title: o.title,
          due_at: o.dueAt,
          status: o.status,
          assigned_to: o.assignedTo,
          submitted_at: o.submittedAt,
          evidence_name: o.evidenceName,
          updated_at: o.updatedAt,
          institution_name: inst?.name || 'Unknown',
          region: inst?.region || null,
        };
      });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

app.post('/api/compliance/:obligationId/decision', currentUserMiddleware, requireRoles('super_admin', 'central_officer', 'regional_officer', 'scrutiny_officer'), async (req, res) => {
  try {
    const user = (req as any).user;
    const obligationId = String(req.params.obligationId);
    const { status, reason } = req.body;

    if (!['Verified', 'Correction required', 'Under verification'].includes(status)) {
      res.status(422).json({ detail: 'Unsupported compliance decision' });
      return;
    }

    const row = await db.orm.public.ComplianceObligation.where({ id: obligationId }).first();
    if (!row) {
      res.status(404).json({ detail: 'Obligation not found' });
      return;
    }

    const inst = await db.orm.public.Institution.where({ id: row.institutionId }).first();
    if (user.role === 'regional_officer' && inst?.region !== user.regionId) {
      res.status(404).json({ detail: 'Obligation not found' });
      return;
    }
    if (user.role === 'scrutiny_officer') {
      const allApps = await db.orm.public.Application.all();
      const assigned = allApps.some((a: any) => a.assignedTo === user.id && a.institutionId === row.institutionId && (!row.applicationId || a.id === row.applicationId));
      if (!assigned) {
        res.status(404).json({ detail: 'Obligation not found' });
        return;
      }
    }

    const oldState = { status: row.status };
    const nowStr = iso();

    await db.orm.public.ComplianceObligation.where({ id: obligationId }).update({
      status,
      updatedAt: nowStr,
    });

    await audit(user.id, 'Compliance decision', 'compliance_obligation', obligationId, reason, oldState, { status });

    const updated = await db.orm.public.ComplianceObligation.where({ id: obligationId }).first();
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

app.post('/api/compliance/:obligationId/submit', currentUserMiddleware, requireRoles('institution'), async (req, res) => {
  try {
    const user = (req as any).user;
    const obligationId = String(req.params.obligationId);
    const { evidence_name, submission_note = '' } = req.body;

    const row = await db.orm.public.ComplianceObligation.where({ id: obligationId }).first();
    if (!row || row.institutionId !== user.institutionId) {
      res.status(404).json({ detail: 'Obligation not found' });
      return;
    }
    if (['Verified', 'Closed'].includes(row.status)) {
      res.status(409).json({ detail: 'A closed or verified obligation cannot be resubmitted' });
      return;
    }

    const previous = { status: row.status, evidence_name: row.evidenceName };
    const nowStr = iso();

    await db.orm.public.ComplianceObligation.where({ id: obligationId }).update({
      status: 'Under verification',
      submittedAt: nowStr,
      evidenceName: evidence_name,
      updatedAt: nowStr,
    });

    await audit(
      user.id,
      'Compliance evidence submitted',
      'compliance_obligation',
      obligationId,
      submission_note || 'Evidence submitted by institution for authorised verification',
      previous,
      { status: 'Under verification', evidence_name }
    );

    const updated = await db.orm.public.ComplianceObligation.where({ id: obligationId }).first();
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Documents
app.get('/api/documents', currentUserMiddleware, async (req, res) => {
  try {
    const user = (req as any).user;
    const [allDocs, allInsts, allApps] = await Promise.all([
      db.orm.public.InstitutionalDocument.all(),
      db.orm.public.Institution.all(),
      db.orm.public.Application.all(),
    ]);

    const instMap = new Map(allInsts.map((i: any) => [i.id, i]));
    let rows = allDocs;

    if (user.role === 'institution') {
      rows = rows.filter((d: any) => d.institutionId === user.institutionId);
    } else if (user.role === 'regional_officer') {
      rows = rows.filter((d: any) => instMap.get(d.institutionId)?.region === user.regionId);
    } else if (['scrutiny_officer', 'evc_member'].includes(user.role)) {
      const assignedInstIds = new Set(allApps.filter((a: any) => a.assignedTo === user.id).map((a: any) => a.institutionId));
      rows = rows.filter((d: any) => assignedInstIds.has(d.institutionId));
    }

    const now = nowUtc();
    const result = rows
      .sort((a: any, b: any) => (a.expiresAt || '').localeCompare(b.expiresAt || ''))
      .map((d: any) => {
        const inst = instMap.get(d.institutionId);
        let daysToExpiry: number | null = null;
        if (d.expiresAt) {
          const expDate = new Date(d.expiresAt);
          daysToExpiry = Math.round((expDate.getTime() - now.getTime()) / 86400000);
        }
        return {
          id: d.id,
          institution_id: d.institutionId,
          category: d.category,
          file_name: d.fileName,
          expires_at: d.expiresAt,
          status: d.status,
          storage_key: d.storageKey,
          uploaded_at: d.uploadedAt,
          verified_by: d.verifiedBy,
          verified_at: d.verifiedAt,
          institution_name: inst?.name || 'Unknown',
          region: inst?.region || null,
          days_to_expiry: daysToExpiry,
        };
      });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

app.post('/api/documents/upload', currentUserMiddleware, upload.single('file'), async (req, res) => {
  try {
    const user = (req as any).user;
    const { institution_id, category, expires_at } = req.body;
    const file = req.file;

    if (!file) {
      res.status(400).json({ detail: 'No file uploaded' });
      return;
    }
    if (user.role === 'institution' && institution_id !== user.institutionId) {
      res.status(404).json({ detail: 'Institution not found' });
      return;
    }
    if (!['institution', 'super_admin', 'central_officer', 'regional_officer'].includes(user.role)) {
      res.status(403).json({ detail: 'Document upload is not permitted' });
      return;
    }

    const inst = await db.orm.public.Institution.where({ id: institution_id }).first();
    if (!inst) {
      res.status(404).json({ detail: 'Institution not found' });
      return;
    }
    if (user.role === 'regional_officer' && inst.region !== user.regionId) {
      res.status(403).json({ detail: 'Institution is outside your region' });
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.pdf', '.png', '.jpg', '.jpeg'];
    if (!allowedExts.includes(ext)) {
      res.status(415).json({ detail: 'Only PDF, PNG, and JPEG files are accepted' });
      return;
    }

    // Verify file content signatures (magic bytes)
    const buf = file.buffer;
    let validSignature = false;
    if (ext === '.pdf' && buf.subarray(0, 5).toString('ascii') === '%PDF-') {
      validSignature = true;
    } else if (ext === '.png' && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      validSignature = true;
    } else if ((ext === '.jpg' || ext === '.jpeg') && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      validSignature = true;
    }

    if (!validSignature) {
      res.status(415).json({ detail: 'File contents do not match the selected document type' });
      return;
    }

    const ident = crypto.randomUUID();
    const storageKey = `${ident}${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, storageKey), buf);

    const nowStr = iso();
    await db.orm.public.InstitutionalDocument.create({
      id: ident,
      institutionId: institution_id,
      category,
      fileName: path.basename(file.originalname),
      expiresAt: expires_at ? new Date(expires_at).toISOString() : null,
      status: 'Under verification',
      storageKey,
      uploadedAt: nowStr,
      verifiedBy: null,
      verifiedAt: null,
    });

    await audit(user.id, 'Document uploaded', 'document', ident, 'Evidence submitted for human verification', null, { category });

    const newDoc = await db.orm.public.InstitutionalDocument.where({ id: ident }).first();
    res.status(201).json(newDoc);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

app.post('/api/documents/:documentId/decision', currentUserMiddleware, requireRoles('super_admin', 'central_officer', 'regional_officer', 'scrutiny_officer'), async (req, res) => {
  try {
    const user = (req as any).user;
    const documentId = String(req.params.documentId);
    const { status, reason } = req.body;

    if (!['Verified', 'Correction required', 'Under verification'].includes(status)) {
      res.status(422).json({ detail: 'Unsupported document decision' });
      return;
    }

    const row = await db.orm.public.InstitutionalDocument.where({ id: documentId }).first();
    if (!row) {
      res.status(404).json({ detail: 'Document not found' });
      return;
    }

    const inst = await db.orm.public.Institution.where({ id: row.institutionId }).first();
    if (user.role === 'regional_officer' && inst?.region !== user.regionId) {
      res.status(404).json({ detail: 'Document not found' });
      return;
    }
    if (user.role === 'scrutiny_officer') {
      const allApps = await db.orm.public.Application.all();
      const assigned = allApps.some((a: any) => a.assignedTo === user.id && a.institutionId === row.institutionId);
      if (!assigned) {
        res.status(404).json({ detail: 'Document not found' });
        return;
      }
    }

    const previous = { status: row.status };
    const verified = status === 'Verified';
    const nowStr = iso();

    await db.orm.public.InstitutionalDocument.where({ id: documentId }).update({
      status,
      verifiedBy: verified ? user.id : null,
      verifiedAt: verified ? nowStr : null,
    });

    await audit(user.id, 'Document decision', 'document', documentId, reason, previous, { status });

    const updated = await db.orm.public.InstitutionalDocument.where({ id: documentId }).first();
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Document Renewal
app.post('/api/documents/:documentId/renew', currentUserMiddleware, upload.single('file'), async (req, res) => {
  try {
    const user = (req as any).user;
    const documentId = String(req.params.documentId);
    const { expires_at } = req.body;
    const file = req.file;

    if (!file) {
      res.status(400).json({ detail: 'No renewed document file uploaded' });
      return;
    }

    const doc = await db.orm.public.InstitutionalDocument.where({ id: documentId }).first();
    if (!doc) {
      res.status(404).json({ detail: 'Document not found' });
      return;
    }
    if (user.role === 'institution' && doc.institutionId !== user.institutionId) {
      res.status(403).json({ detail: 'You do not own this document' });
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.pdf', '.png', '.jpg', '.jpeg'];
    if (!allowedExts.includes(ext)) {
      res.status(415).json({ detail: 'Only PDF, PNG, and JPEG files are accepted' });
      return;
    }

    const buf = file.buffer;
    let validSignature = false;
    if (ext === '.pdf' && buf.subarray(0, 5).toString('ascii') === '%PDF-') {
      validSignature = true;
    } else if (ext === '.png' && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      validSignature = true;
    } else if ((ext === '.jpg' || ext === '.jpeg') && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      validSignature = true;
    }

    if (!validSignature) {
      res.status(415).json({ detail: 'File contents do not match the expected format' });
      return;
    }

    const ident = crypto.randomUUID();
    const storageKey = `${ident}${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, storageKey), buf);

    const nowStr = iso();
    const currentVersion = (doc.versionNumber || 1) + 1;

    await db.orm.public.InstitutionalDocument.where({ id: documentId }).update({
      fileName: path.basename(file.originalname),
      expiresAt: expires_at ? new Date(expires_at).toISOString() : null,
      status: 'Renewal submitted',
      storageKey,
      uploadedAt: nowStr,
      verifiedBy: null,
      verifiedAt: null,
      versionNumber: currentVersion,
    });

    await audit(user.id, 'Document renewed', 'document', documentId, `Renewed version ${currentVersion} uploaded for verification`, { version: doc.versionNumber }, { version: currentVersion, fileName: file.originalname });

    const updated = await db.orm.public.InstitutionalDocument.where({ id: documentId }).first();
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// EVC Workspace
app.get('/api/evc', currentUserMiddleware, requireRoles('super_admin', 'central_officer', 'regional_officer', 'evc_member'), async (req, res) => {
  try {
    const user = (req as any).user;
    const [events, applications, institutions] = await Promise.all([
      db.orm.public.EvcEvent.all(),
      db.orm.public.Application.all(),
      db.orm.public.Institution.all(),
    ]);

    const appMap = new Map(applications.map((a: any) => [a.id, a]));
    const instMap = new Map(institutions.map((i: any) => [i.id, i]));

    let rows = events.map((e: any) => {
      const app = appMap.get(e.applicationId);
      const inst = app ? instMap.get(app.institutionId) : null;
      return {
        id: e.id,
        application_id: e.applicationId,
        scheduled_at: e.scheduledAt,
        location: e.location,
        committee: e.committee,
        status: e.status,
        created_by: e.createdBy,
        reason: e.reason,
        report_notes: e.reportNotes || null,
        recommendation: e.recommendation || null,
        reported_at: e.reportedAt || null,
        reference: app?.reference || 'Unknown',
        institution_name: inst?.name || 'Unknown',
        region: inst?.region || null,
      };
    });

    if (user.role === 'regional_officer') {
      rows = rows.filter((r: any) => r.region === user.regionId);
    } else if (user.role === 'evc_member') {
      const assignedAppIds = new Set(applications.filter((a: any) => a.assignedTo === user.id).map((a: any) => a.id));
      rows = rows.filter((r: any) => assignedAppIds.has(r.application_id));
    }

    res.json(rows.sort((a: any, b: any) => a.scheduled_at.localeCompare(b.scheduled_at)));
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

app.post('/api/evc', currentUserMiddleware, requireRoles('super_admin', 'central_officer', 'regional_officer'), async (req, res) => {
  try {
    const user = (req as any).user;
    const { application_id, scheduled_at, location, committee, reason } = req.body;

    const scheduledDate = new Date(scheduled_at);
    if (isNaN(scheduledDate.getTime())) {
      res.status(422).json({ detail: 'scheduled_at must be a valid date' });
      return;
    }
    if (scheduledDate <= nowUtc()) {
      res.status(422).json({ detail: 'Visit must be scheduled in the future' });
      return;
    }

    const application = await db.orm.public.Application.where({ id: application_id }).first();
    if (!application || application.stage !== 'EVC') {
      res.status(409).json({ detail: 'Only applications currently at the EVC stage may be scheduled' });
      return;
    }

    if (user.role === 'regional_officer') {
      const inst = await db.orm.public.Institution.where({ id: application.institutionId }).first();
      if (!inst || inst.region !== user.regionId) {
        res.status(404).json({ detail: 'Application not found' });
        return;
      }
    }

    const allEvc = await db.orm.public.EvcEvent.all();
    const conflict = allEvc.find((e: any) => e.committee === committee && e.scheduledAt === scheduledDate.toISOString() && e.status === 'Scheduled');
    if (conflict) {
      res.status(409).json({ detail: 'This committee already has a visit at the selected time' });
      return;
    }

    const ident = crypto.randomUUID();
    const nowStr = iso();

    await db.orm.public.EvcEvent.create({
      id: ident,
      applicationId: application_id,
      scheduledAt: scheduledDate.toISOString(),
      location,
      committee,
      status: 'Scheduled',
      createdBy: user.id,
      reason,
      reportNotes: null,
      recommendation: null,
      reportedAt: null,
      reportedBy: null,
    });

    await db.orm.public.Application.where({ id: application_id }).update({
      status: 'Scheduled',
      updatedAt: nowStr,
    });

    await audit(user.id, 'EVC scheduled', 'application', application_id, reason, { status: application.status }, { status: 'Scheduled', scheduled_at: scheduledDate.toISOString() });

    await db.orm.public.StageEvent.create({
      id: crypto.randomUUID(),
      applicationId: application_id,
      fromStage: 'EVC',
      toStage: 'EVC',
      action: 'EVC scheduled',
      reason,
      actorId: user.id,
      createdAt: nowStr,
    });

    const newEvc = await db.orm.public.EvcEvent.where({ id: ident }).first();
    res.status(201).json(newEvc);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Submit EVC Inspection Report
app.post('/api/evc/:evcId/report', currentUserMiddleware, requireRoles('evc_member', 'central_officer', 'regional_officer', 'super_admin'), async (req, res) => {
  try {
    const user = (req as any).user;
    const evcId = String(req.params.evcId);
    const { report_notes, recommendation } = req.body;

    if (!report_notes || !recommendation) {
      res.status(422).json({ detail: 'Inspection observations and committee recommendation are required' });
      return;
    }

    const row = await db.orm.public.EvcEvent.where({ id: evcId }).first();
    if (!row) {
      res.status(404).json({ detail: 'EVC event not found' });
      return;
    }

    const nowStr = iso();

    await db.orm.public.EvcEvent.where({ id: evcId }).update({
      status: 'Report submitted',
      reportNotes: report_notes,
      recommendation,
      reportedAt: nowStr,
      reportedBy: user.id,
    });

    // Advance application from EVC stage to next stage
    const app = await db.orm.public.Application.where({ id: row.applicationId }).first();
    if (app && app.stage === 'EVC') {
      const version = await db.orm.public.WorkflowVersion.where({ id: app.workflowVersionId }).first();
      let nextStage = app.stage;
      let nextStatus = 'Report submitted';
      if (version) {
        const stages: string[] = JSON.parse(version.stagesJson);
        const idx = stages.indexOf('EVC');
        if (idx !== -1 && idx < stages.length - 1) {
          nextStage = stages[idx + 1];
          nextStatus = 'Pending';
        }
      }

      await db.orm.public.Application.where({ id: row.applicationId }).update({
        stage: nextStage,
        status: nextStatus,
        updatedAt: nowStr,
      });

      await db.orm.public.StageEvent.create({
        id: crypto.randomUUID(),
        applicationId: row.applicationId,
        fromStage: 'EVC',
        toStage: nextStage,
        action: 'EVC report submitted',
        reason: `Committee recommendation: ${recommendation}. Observations: ${report_notes}`,
        actorId: user.id,
        createdAt: nowStr,
      });
    }

    await audit(user.id, 'EVC inspection report submitted', 'evc_event', evcId, `Recommendation: ${recommendation}`, null, { recommendation, reportNotes: report_notes });

    const updated = await db.orm.public.EvcEvent.where({ id: evcId }).first();
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Notifications
app.get('/api/notifications', currentUserMiddleware, async (req, res) => {
  try {
    const user = (req as any).user;
    const allNotices = await db.orm.public.Notification.all();
    const userNotices = allNotices
      .filter((n: any) => n.userId === user.id)
      .sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt))
      .map((n: any) => ({
        id: n.id,
        user_id: n.userId,
        title: n.title,
        body: n.body,
        category: n.category,
        related_id: n.relatedId,
        created_at: n.createdAt,
        read_at: n.readAt,
      }));

    res.json(userNotices);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

app.post('/api/notifications/:id/read', currentUserMiddleware, async (req, res) => {
  try {
    const user = (req as any).user;
    const noticeId = String(req.params.id);
    const notice = await db.orm.public.Notification.where({ id: noticeId }).first();
    if (!notice || notice.userId !== user.id) {
      res.status(404).json({ detail: 'Notification not found' });
      return;
    }
    await db.orm.public.Notification.where({ id: noticeId }).update({ readAt: iso() });
    res.json({ status: 'marked read' });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

app.post('/api/notifications/read-all', currentUserMiddleware, async (req, res) => {
  try {
    const user = (req as any).user;
    const all = await db.orm.public.Notification.all();
    const userNotices = all.filter((n: any) => n.userId === user.id && !n.readAt);
    const nowStr = iso();
    for (const n of userNotices) {
      await db.orm.public.Notification.where({ id: n.id }).update({ readAt: nowStr });
    }
    res.json({ status: 'all read', count: userNotices.length });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});


// Audit trail
app.get('/api/audit', currentUserMiddleware, requireRoles('super_admin', 'central_officer', 'regional_officer'), async (req, res) => {
  try {
    const user = (req as any).user;
    const [auditList, users, applications, obligations, documents, institutions] = await Promise.all([
      db.orm.public.AuditEvent.all(),
      db.orm.public.User.all(),
      db.orm.public.Application.all(),
      db.orm.public.ComplianceObligation.all(),
      db.orm.public.InstitutionalDocument.all(),
      db.orm.public.Institution.all(),
    ]);

    const userMap = new Map(users.map((u: any) => [u.id, u]));
    const instMap = new Map(institutions.map((i: any) => [i.id, i]));

    let result = auditList
      .sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 200)
      .map((a: any) => ({
        id: a.id,
        actor_id: a.actorId,
        actor: userMap.get(a.actorId)?.name || 'Unknown',
        action: a.action,
        entity_type: a.entityType,
        entity_id: a.entityId,
        reason: a.reason,
        created_at: a.createdAt,
      }));

    if (user.role === 'regional_officer') {
      const allowed = new Set<string>();
      for (const app of applications) {
        const inst = instMap.get(app.institutionId);
        if (inst && inst.region === user.regionId) {
          allowed.add(`application:${app.id}`);
        }
      }
      for (const ob of obligations) {
        const inst = instMap.get(ob.institutionId);
        if (inst && inst.region === user.regionId) {
          allowed.add(`compliance_obligation:${ob.id}`);
        }
      }
      for (const doc of documents) {
        const inst = instMap.get(doc.institutionId);
        if (inst && inst.region === user.regionId) {
          allowed.add(`document:${doc.id}`);
        }
      }

      result = result.filter((item: any) => allowed.has(`${item.entity_type}:${item.entity_id}`));
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Escalations
app.get('/api/escalations', currentUserMiddleware, requireRoles('super_admin', 'central_officer', 'regional_officer'), async (req, res) => {
  try {
    const user = (req as any).user;
    const [escalationList, applications, obligations, institutions] = await Promise.all([
      db.orm.public.EscalationEvent.all(),
      db.orm.public.Application.all(),
      db.orm.public.ComplianceObligation.all(),
      db.orm.public.Institution.all(),
    ]);

    const appMap = new Map(applications.map((a: any) => [a.id, a]));
    const obMap = new Map(obligations.map((o: any) => [o.id, o]));
    const instMap = new Map(institutions.map((i: any) => [i.id, i]));

    const result: any[] = [];
    for (const row of escalationList) {
      let reference = '';
      let instName = '';
      let region = '';

      if (row.entityType === 'application') {
        const app = appMap.get(row.entityId);
        if (!app) continue;
        const inst = instMap.get(app.institutionId);
        reference = app.reference;
        instName = inst?.name || 'Unknown';
        region = inst?.region || '';
      } else {
        const ob = obMap.get(row.entityId);
        if (!ob) continue;
        const inst = instMap.get(ob.institutionId);
        reference = ob.title;
        instName = inst?.name || 'Unknown';
        region = inst?.region || '';
      }

      if (user.role === 'regional_officer' && region !== user.regionId) {
        continue;
      }

      result.push({
        id: row.id,
        entity_type: row.entityType,
        entity_id: row.entityId,
        reason: row.reason,
        status: row.status,
        created_at: row.createdAt,
        resolved_at: row.resolvedAt,
        resolved_by: row.resolvedBy,
        reference,
        institution_name: instName,
        region,
      });
    }

    res.json(result.sort((a, b) => {
      if (a.status === 'Open' && b.status !== 'Open') return -1;
      if (a.status !== 'Open' && b.status === 'Open') return 1;
      return b.created_at.localeCompare(a.created_at);
    }));
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

app.post('/api/escalations/:escalationId/resolve', currentUserMiddleware, requireRoles('super_admin', 'central_officer', 'regional_officer'), async (req, res) => {
  try {
    const user = (req as any).user;
    const escalationId = String(req.params.escalationId);
    const { reason } = req.body;

    const row = await db.orm.public.EscalationEvent.where({ id: escalationId }).first();
    if (!row) {
      res.status(404).json({ detail: 'Escalation not found' });
      return;
    }

    if (user.role === 'regional_officer') {
      const allInsts = await db.orm.public.Institution.all();
      const instMap = new Map(allInsts.map((i: any) => [i.id, i]));
      let region = '';
      if (row.entityType === 'application') {
        const app = await db.orm.public.Application.where({ id: row.entityId }).first();
        if (app) region = instMap.get(app.institutionId)?.region || '';
      } else {
        const ob = await db.orm.public.ComplianceObligation.where({ id: row.entityId }).first();
        if (ob) region = instMap.get(ob.institutionId)?.region || '';
      }
      if (region !== user.regionId) {
        res.status(404).json({ detail: 'Escalation not found' });
        return;
      }
    }

    if (row.status !== 'Open') {
      res.status(409).json({ detail: 'Escalation is already resolved' });
      return;
    }

    const nowStr = iso();
    await db.orm.public.EscalationEvent.where({ id: escalationId }).update({
      status: 'Resolved',
      resolvedAt: nowStr,
      resolvedBy: user.id,
    });

    await audit(user.id, 'Escalation resolved', row.entityType, row.entityId, reason, { status: 'Open' }, { status: 'Resolved' });

    const updated = await db.orm.public.EscalationEvent.where({ id: escalationId }).first();
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Idempotent Deadline Check
app.post('/api/admin/run-deadline-check', currentUserMiddleware, requireRoles('super_admin'), async (_req, res) => {
  try {
    let notificationsCreated = 0;
    let escalationsCreated = 0;
    const now = nowUtc();
    const today = new Date(now.toISOString().split('T')[0]);

    const [obligations, applications, documents, users, existingEscalations, existingNotices] = await Promise.all([
      db.orm.public.ComplianceObligation.all(),
      db.orm.public.Application.all(),
      db.orm.public.InstitutionalDocument.all(),
      db.orm.public.User.all(),
      db.orm.public.EscalationEvent.all(),
      db.orm.public.Notification.all(),
    ]);

    const escalationKeys = new Set(existingEscalations.map((e: any) => `${e.entityType}:${e.entityId}`));
    const noticeKeys = new Set(existingNotices.map((n: any) => `${n.userId}:${n.category}:${n.relatedId}`));

    const dueItems = [
      ...obligations.filter((o: any) => !['Verified', 'Closed'].includes(o.status)).map((o: any) => ({
        id: o.id,
        institution_id: o.institutionId,
        title: o.title,
        due_at: o.dueAt,
        kind: 'obligation',
      })),
      ...applications.filter((a: any) => a.stage !== 'Completed').map((a: any) => ({
        id: a.id,
        institution_id: a.institutionId,
        title: a.reference,
        due_at: a.dueAt,
        kind: 'application',
      })),
    ];

    for (const item of dueItems) {
      const due = new Date(item.due_at.split('T')[0]);
      if (due < today) {
        const key = `${item.kind === 'application' ? 'application' : 'compliance_obligation'}:${item.id}`;
        if (!escalationKeys.has(key)) {
          await db.orm.public.EscalationEvent.create({
            id: crypto.randomUUID(),
            entityType: item.kind === 'application' ? 'application' : 'compliance_obligation',
            entityId: item.id,
            reason: `Recorded deadline ${due.toISOString().split('T')[0]} has passed; officer follow-up is required.`,
            status: 'Open',
            createdAt: iso(),
            resolvedAt: null,
            resolvedBy: null,
          });
          escalationKeys.add(key);
          escalationsCreated++;
        }
      }

      const daysDiff = (due.getTime() - today.getTime()) / 86400000;
      if (daysDiff <= 3) {
        const recipient = users.find((u: any) => u.institutionId === item.institution_id);
        if (recipient) {
          const category = `${item.kind}_deadline`;
          const noticeKey = `${recipient.id}:${category}:${item.id}`;
          if (!noticeKeys.has(noticeKey)) {
            const title = due < today ? 'Action overdue' : 'Deadline approaching';
            const body = `${item.title} is due ${due.toISOString().split('T')[0]}. Please review the recorded requirement.`;
            await db.orm.public.Notification.create({
              id: crypto.randomUUID(),
              userId: recipient.id,
              title,
              body,
              category,
              relatedId: item.id,
              createdAt: iso(),
              readAt: null,
            });
            noticeKeys.add(noticeKey);
            notificationsCreated++;
          }
        }
      }
    }

    // Expiring documents check
    for (const doc of documents) {
      if (!doc.expiresAt || ['Verified renewed', 'Closed'].includes(doc.status)) continue;
      const expDate = new Date(doc.expiresAt.split('T')[0]);
      const daysDiff = (expDate.getTime() - today.getTime()) / 86400000;
      if (daysDiff <= 30) {
        const recipient = users.find((u: any) => u.institutionId === doc.institutionId);
        if (recipient) {
          const category = 'document_expiry';
          const noticeKey = `${recipient.id}:${category}:${doc.id}`;
          if (!noticeKeys.has(noticeKey)) {
            await db.orm.public.Notification.create({
              id: crypto.randomUUID(),
              userId: recipient.id,
              title: 'Document expiry follow-up',
              body: `${doc.category} has a recorded expiry date of ${expDate.toISOString().split('T')[0]}. Review renewal requirements.`,
              category,
              relatedId: doc.id,
              createdAt: iso(),
              readAt: null,
            });
            noticeKeys.add(noticeKey);
            notificationsCreated++;
          }
        }
      }
    }

    res.json({ notifications_created: notificationsCreated, escalations_created: escalationsCreated });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Institutions
app.get('/api/institutions', currentUserMiddleware, async (req, res) => {
  try {
    const user = (req as any).user;
    const [allInsts, allApps] = await Promise.all([
      db.orm.public.Institution.all(),
      db.orm.public.Application.all(),
    ]);

    let rows = allInsts;
    if (user.role === 'institution') {
      rows = rows.filter((i: any) => i.id === user.institutionId);
    } else if (user.role === 'regional_officer') {
      rows = rows.filter((i: any) => i.region === user.regionId);
    } else if (['scrutiny_officer', 'evc_member'].includes(user.role)) {
      const assignedInstIds = new Set(allApps.filter((a: any) => a.assignedTo === user.id).map((a: any) => a.institutionId));
      rows = rows.filter((i: any) => assignedInstIds.has(i.id));
    }

    res.json(rows.sort((a: any, b: any) => a.name.localeCompare(b.name)));
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Reports & CSV export
app.get('/api/reports/summary', currentUserMiddleware, requireRoles('super_admin', 'central_officer', 'regional_officer'), async (req, res) => {
  try {
    const user = (req as any).user;
    const [allApps, allInsts, allUsers] = await Promise.all([
      db.orm.public.Application.all(),
      db.orm.public.Institution.all(),
      db.orm.public.User.all(),
    ]);

    const instMap = new Map(allInsts.map((i: any) => [i.id, i]));
    const userMap = new Map(allUsers.map((u: any) => [u.id, u]));

    const visibleApps = allApps
      .filter((a: any) => visibleApplication(user, a, instMap))
      .map((a: any) => serializeApplication(a, instMap, userMap));

    const stages: Record<string, number> = {};
    const regions: Record<string, number> = {};
    const ageing: Record<string, number> = { '0-7 days': 0, '8-30 days': 0, '31-60 days': 0, 'Over 60 days': 0 };
    const overdueByUnit: Record<string, number> = {};

    const now = nowUtc();

    for (const item of visibleApps) {
      stages[item.stage] = (stages[item.stage] || 0) + 1;
      if (item.stage === 'Completed') continue;

      if (item.region) {
        regions[item.region] = (regions[item.region] || 0) + 1;
      }
      const ageDays = Math.max(0, Math.round((now.getTime() - new Date(item.submitted_at).getTime()) / 86400000));
      const band = ageDays <= 7 ? '0-7 days' : ageDays <= 30 ? '8-30 days' : ageDays <= 60 ? '31-60 days' : 'Over 60 days';
      ageing[band]++;

      if (new Date(item.due_at) < now) {
        const unit = item.assignee;
        overdueByUnit[unit] = (overdueByUnit[unit] || 0) + 1;
      }
    }

    res.json({
      generated_at: iso(),
      total_applications: visibleApps.length,
      stage_distribution: Object.entries(stages).sort((a, b) => a[0].localeCompare(b[0])).map(([stage, count]) => ({ stage, count })),
      region_pendency: Object.entries(regions).sort((a, b) => a[0].localeCompare(b[0])).map(([region, count]) => ({ region, count })),
      ageing: Object.entries(ageing).map(([band, count]) => ({ band, count })),
      overdue_by_unit: Object.entries(overdueByUnit).sort((a, b) => a[0].localeCompare(b[0])).map(([unit, count]) => ({ unit, count })),
    });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

app.get('/api/reports/applications.csv', currentUserMiddleware, requireRoles('super_admin', 'central_officer', 'regional_officer'), async (req, res) => {
  try {
    const user = (req as any).user;
    const [allApps, allInsts, allUsers] = await Promise.all([
      db.orm.public.Application.all(),
      db.orm.public.Institution.all(),
      db.orm.public.User.all(),
    ]);

    const instMap = new Map(allInsts.map((i: any) => [i.id, i]));
    const userMap = new Map(allUsers.map((u: any) => [u.id, u]));

    const visibleApps = allApps
      .filter((a: any) => visibleApplication(user, a, instMap))
      .sort((a: any, b: any) => b.submittedAt.localeCompare(a.submittedAt))
      .map((a: any) => serializeApplication(a, instMap, userMap));

    function safeCell(value: any): string {
      let text = value === null || value === undefined ? '' : String(value);
      if (/^[=+\-@]/.test(text.trimStart())) {
        text = "'" + text;
      }
      if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        return `"${text.replaceAll('"', '""')}"`;
      }
      return text;
    }

    const headers = ['Application reference', 'Institution', 'Region', 'Application type', 'Cycle', 'Stage', 'Status', 'Assigned to', 'Submitted at (UTC)', 'Due at (UTC)'];
    const lines = [headers.join(',')];

    for (const item of visibleApps) {
      lines.push([
        safeCell(item.reference),
        safeCell(item.institution_name),
        safeCell(item.region),
        safeCell(item.application_type),
        safeCell(item.cycle),
        safeCell(item.stage),
        safeCell(item.status),
        safeCell(item.assignee),
        safeCell(item.submitted_at),
        safeCell(item.due_at),
      ].join(','));
    }

    const csvContent = lines.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="authorised-applications.csv"');
    res.send(csvContent);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Start server
app.listen(PORT, async () => {
  console.log(`AICTE Server is running on http://localhost:${PORT}`);
  await seed();
});
