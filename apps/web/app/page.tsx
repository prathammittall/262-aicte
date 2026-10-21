"use client";

import {
  Activity, AlertTriangle, ArrowDownRight, ArrowRight, BarChart3, Bell, BookOpenCheck, Building2,
  CalendarDays, Check, ChevronDown, ClipboardList, Clock3, FileCheck2, FileText,
  LayoutDashboard, LogOut, Menu, Search, ShieldCheck, Users, X,
  Settings2, Plus, RefreshCw, Send, CheckCircle2, XCircle, AlertCircle
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const CONFIGURED_API_URL = process.env.NEXT_PUBLIC_API_URL;

function apiBaseUrl() {
  if (CONFIGURED_API_URL) return CONFIGURED_API_URL;
  return typeof window === "undefined" ? "http://localhost:3000" : `http://${window.location.hostname}:3000`;
}

type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  region_id?: string | null;
  institution_id?: string | null;
};

type Application = {
  id: string;
  reference: string;
  institution_id?: string;
  institution_name: string;
  region: string;
  application_type: string;
  cycle: string;
  stage: string;
  status: string;
  due_at: string;
  submitted_at: string;
  assignee: string;
  summary: string;
  decision_notes?: string | null;
  decision_at?: string | null;
};

type Dashboard = {
  refreshed_at: string;
  counts: Record<string, number>;
  stage_distribution: { stage: string; count: number }[];
  applications: Application[];
};

type Compliance = {
  id: string;
  title: string;
  institution_name: string;
  region: string;
  due_at: string;
  status: string;
  application_id?: string;
  notes?: string | null;
};

type DocumentRow = {
  id: string;
  category: string;
  file_name: string;
  institution_name: string;
  expires_at: string;
  status: string;
  days_to_expiry: number | null;
  version_number?: number;
};

type Evc = {
  id: string;
  reference: string;
  application_id: string;
  institution_name: string;
  region: string;
  scheduled_at: string;
  location: string;
  committee: string;
  status: string;
  report_notes?: string | null;
  recommendation?: string | null;
  reported_at?: string | null;
};

type Notice = {
  id: string;
  title: string;
  body: string;
  category: string;
  created_at: string;
  read_at?: string | null;
};

type AuditRow = {
  id: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  reason: string;
  created_at: string;
};

type Institution = {
  id: string;
  name: string;
  code: string;
  region: string;
  city: string;
  status: string;
};

type WorkflowTemplate = {
  template_id: string;
  name: string;
  description: string;
  workflow_version_id: string;
  version: number;
  stages: string[];
};

type WorkflowVersion = {
  id: string;
  template_id: string;
  template_name: string;
  version: number;
  status: string;
  stages: string[];
  active_version_id: string | null;
};

type Escalation = {
  id: string;
  entity_type: string;
  entity_id: string;
  reason: string;
  status: string;
  created_at: string;
  reference: string;
  institution_name: string;
  region: string;
};

type ReportSummary = {
  generated_at: string;
  total_applications: number;
  stage_distribution: { stage: string; count: number }[];
  region_pendency: { region: string; count: number }[];
  ageing: { band: string; count: number }[];
  overdue_by_unit: { unit: string; count: number }[];
};

type ScrutinyObservation = {
  id: string;
  application_id: string;
  category: string;
  finding: string;
  status: string;
  officer_name: string;
  created_at: string;
};

const roleLabels: Record<string, string> = {
  super_admin: "Super Administrator",
  central_officer: "Bureau Officer",
  competent_authority: "Competent Authority",
  regional_officer: "Regional Officer",
  scrutiny_officer: "Scrutiny Officer",
  evc_member: "EVC Committee Member",
  institution: "Institution Administrator",
};

const DEMO_PERSONAS = [
  { role: "super_admin", email: "admin@demo.aicte.local", name: "Aarav Mehta", title: "Super Admin" },
  { role: "central_officer", email: "bureau@demo.aicte.local", name: "Sanjay Deshmukh", title: "Bureau Officer" },
  { role: "competent_authority", email: "authority@demo.aicte.local", name: "Dr. Vikram Malhotra", title: "Competent Authority" },
  { role: "regional_officer", email: "north@demo.aicte.local", name: "Rohan Verma", title: "Regional Officer (North)" },
  { role: "scrutiny_officer", email: "scrutiny@demo.aicte.local", name: "Isha Nair", title: "Scrutiny Officer" },
  { role: "evc_member", email: "evc@demo.aicte.local", name: "Dev Patel", title: "EVC Member" },
  { role: "institution", email: "institution@demo.aicte.local", name: "Ananya Sharma", title: "Institution Admin" },
];

const nav = [
  { id: "dashboard", label: "Overview", icon: LayoutDashboard },
  { id: "applications", label: "Applications", icon: ClipboardList },
  { id: "institutions", label: "Institutions", icon: Building2 },
  { id: "reports", label: "Reports & analytics", icon: BarChart3 },
  { id: "evc", label: "EVC workspace", icon: CalendarDays },
  { id: "compliance", label: "Compliance & undertakings", icon: BookOpenCheck },
  { id: "documents", label: "Documents & validity", icon: FileCheck2 },
  { id: "escalations", label: "Escalations", icon: AlertTriangle },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "audit", label: "Audit trail", icon: Activity },
  { id: "workflows", label: "Workflow studio", icon: Settings2 },
];

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...options,
    credentials: "include",
    headers: { ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail ?? `Request failed (${response.status})`);
  return payload as T;
}

function date(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(value));
}

function initials(value: string) {
  return value.split(" ").map((word) => word[0]).slice(0, 2).join("").toUpperCase();
}

function Badge({ children }: { children: string }) {
  const status = children.toLowerCase();
  const tone = status.includes("overdue") || status.includes("action required") || status.includes("returned") || status.includes("correction") || status.includes("rejected") || status.includes("deficient")
    ? "red" : status.includes("verified") || status.includes("completed") || status.includes("approved") || status.includes("satisfactory") ? "green"
    : status.includes("scheduled") || status.includes("review") || status.includes("verification") ? "blue"
    : status.includes("due") || status.includes("pending") || status.includes("conditional") ? "amber" : "slate";
  return <span className={`badge ${tone}`}><i />{children}</span>;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [apps, setApps] = useState<Application[]>([]);
  const [compliance, setCompliance] = useState<Compliance[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [evc, setEvc] = useState<Evc[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowTemplate[]>([]);
  const [workflowVersions, setWorkflowVersions] = useState<WorkflowVersion[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [reportSummary, setReportSummary] = useState<ReportSummary | null>(null);
  const [observations, setObservations] = useState<ScrutinyObservation[]>([]);

  const [page, setPage] = useState("dashboard");
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [selected, setSelected] = useState<Application | null>(null);
  const [loginEmail, setLoginEmail] = useState("admin@demo.aicte.local");
  const [loginPassword, setLoginPassword] = useState("DemoPass!2026");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);

  // Modals
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState("");
  const [evcOpen, setEvcOpen] = useState(false);
  const [evcError, setEvcError] = useState("");

  const [decisionOpen, setDecisionOpen] = useState(false);
  const [decisionDecision, setDecisionDecision] = useState("approve");
  const [decisionReason, setDecisionReason] = useState("");
  const [undertakingRows, setUndertakingRows] = useState<{ title: string; due_in_days: number }[]>([
    { title: "Submit registered land lease extension certificate", due_in_days: 30 }
  ]);
  const [decisionError, setDecisionError] = useState("");

  const [evcReportOpen, setEvcReportOpen] = useState(false);
  const [selectedEvc, setSelectedEvc] = useState<Evc | null>(null);
  const [evcReportNotes, setEvcReportNotes] = useState("");
  const [evcRecommendation, setEvcRecommendation] = useState("Recommended");
  const [evcReportError, setEvcReportError] = useState("");

  const [observationOpen, setObservationOpen] = useState(false);
  const [obsCategory, setObsCategory] = useState("Land & Infrastructure Norms");
  const [obsStatus, setObsStatus] = useState("Satisfactory");
  const [obsFinding, setObsFinding] = useState("");
  const [obsError, setObsError] = useState("");

  const [renewOpen, setRenewOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<DocumentRow | null>(null);
  const [renewError, setRenewError] = useState("");

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      const [d, a, c, docs, insts, templates] = await Promise.all([
        api<Dashboard>("/api/dashboard"),
        api<Application[]>("/api/applications"),
        api<Compliance[]>("/api/compliance"),
        api<DocumentRow[]>("/api/documents"),
        api<Institution[]>("/api/institutions"),
        api<WorkflowTemplate[]>("/api/workflows/templates"),
      ]);
      setDashboard(d); setApps(a); setCompliance(c); setDocuments(docs); setInstitutions(insts); setWorkflowTemplates(templates);

      if (user.role === "super_admin") setWorkflowVersions(await api<WorkflowVersion[]>("/api/workflows"));
      else setWorkflowVersions([]);

      if (["super_admin", "central_officer", "regional_officer", "competent_authority"].includes(user.role)) {
        setEscalations(await api<Escalation[]>("/api/escalations"));
      } else setEscalations([]);

      if (["super_admin", "central_officer", "regional_officer", "competent_authority"].includes(user.role)) {
        setReportSummary(await api<ReportSummary>("/api/reports/summary"));
      } else setReportSummary(null);

      if (["super_admin", "central_officer", "regional_officer", "evc_member"].includes(user.role)) {
        setEvc(await api<Evc[]>("/api/evc"));
      } else setEvc([]);

      if (!["institution", "evc_member", "scrutiny_officer"].includes(user.role)) {
        setAudit(await api<AuditRow[]>("/api/audit"));
      } else setAudit([]);

      setNotices(await api<Notice[]>("/api/notifications"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load workspace data");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    let active = true;
    api<User>("/api/auth/me").then((result) => { if (active) setUser(result); })
      .catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Load scrutiny observations when an application is selected
  useEffect(() => {
    if (!selected) {
      setObservations([]);
      return;
    }
    api<ScrutinyObservation[]>(`/api/applications/${selected.id}/scrutiny`)
      .then(setObservations)
      .catch(() => setObservations([]));
  }, [selected]);

  const filteredApps = useMemo(() => apps.filter((item) => {
    const matchesQuery = `${item.reference} ${item.institution_name} ${item.application_type}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (!stageFilter || item.stage === stageFilter);
  }), [apps, query, stageFilter]);

  function clearWorkspaceData() {
    setDashboard(null); setApps([]); setCompliance([]); setDocuments([]); setEvc([]); setNotices([]);
    setAudit([]); setInstitutions([]); setWorkflowTemplates([]); setWorkflowVersions([]); setEscalations([]);
    setReportSummary(null); setSelected(null); setQuery(""); setStageFilter(""); setObservations([]);
  }

  async function switchDemoPersona(email: string) {
    setLoading(true);
    setError("");
    try {
      const res = await api<{ user: User }>("/api/auth/demo-switch", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      clearWorkspaceData();
      setUser(res.user);
      setToast(`Switched persona to ${res.user.name} (${roleLabels[res.user.role] ?? res.user.role})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to switch persona");
    } finally {
      setLoading(false);
    }
  }

  async function signIn(event: FormEvent) {
    event.preventDefault(); setError(""); setLoading(true);
    try {
      const result = await api<{ user: User }>("/api/auth/login", {
        method: "POST", body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      clearWorkspaceData();
      setUser(result.user); setPage("dashboard");
    } catch (e) { setError(e instanceof Error ? e.message : "Sign-in failed"); }
    finally { setLoading(false); }
  }

  async function signOut() {
    await fetch(`${apiBaseUrl()}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined);
    setUser(null); clearWorkspaceData(); setPage("dashboard");
  }

  async function doTransition(action: string) {
    if (!selected) return;
    const reason = window.prompt(action === "return" ? "Enter the deficiency and correction required (min. 5 characters):" : "Enter the reason for this workflow action (min. 5 characters):");
    if (!reason) return;
    try {
      await api(`/api/applications/${selected.id}/transition`, { method: "POST", body: JSON.stringify({ action, reason }) });
      setToast("Workflow action recorded and added to the audit trail.");
      setSelected(null); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to complete action"); }
  }

  async function submitDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setDecisionError("");
    try {
      await api(`/api/applications/${selected.id}/decision`, {
        method: "POST",
        body: JSON.stringify({
          decision: decisionDecision,
          reason: decisionReason,
          undertakings: decisionDecision === "approve_with_undertaking" ? undertakingRows : [],
        }),
      });
      setDecisionOpen(false);
      setSelected(null);
      setToast("Statutory decision successfully entered and logged.");
      await refresh();
    } catch (e) {
      setDecisionError(e instanceof Error ? e.message : "Decision failed to record");
    }
  }

  async function submitObservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setObsError("");
    try {
      await api(`/api/applications/${selected.id}/scrutiny`, {
        method: "POST",
        body: JSON.stringify({
          category: obsCategory,
          status: obsStatus,
          finding: obsFinding,
        }),
      });
      setObservationOpen(false);
      setObsFinding("");
      setToast("Scrutiny observation logged.");
      const updatedObs = await api<ScrutinyObservation[]>(`/api/applications/${selected.id}/scrutiny`);
      setObservations(updatedObs);
      await refresh();
    } catch (e) {
      setObsError(e instanceof Error ? e.message : "Failed to record observation");
    }
  }

  async function submitEvcReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEvc) return;
    setEvcReportError("");
    try {
      await api(`/api/evc/${selectedEvc.id}/report`, {
        method: "POST",
        body: JSON.stringify({
          report_notes: evcReportNotes,
          recommendation: evcRecommendation,
        }),
      });
      setEvcReportOpen(false);
      setSelectedEvc(null);
      setEvcReportNotes("");
      setToast("EVC inspection report submitted.");
      await refresh();
    } catch (e) {
      setEvcReportError(e instanceof Error ? e.message : "Failed to submit EVC report");
    }
  }

  async function submitRenewDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDoc) return;
    setRenewError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await api(`/api/documents/${selectedDoc.id}/renew`, { method: "POST", body: data });
      setRenewOpen(false);
      setSelectedDoc(null);
      setToast("Renewed document uploaded and queued for verification.");
      await refresh();
    } catch (e) {
      setRenewError(e instanceof Error ? e.message : "Document renewal failed");
    }
  }

  async function decideCompliance(item: Compliance, status: string) {
    const reason = window.prompt(`Reason for marking this obligation "${status}":`);
    if (!reason) return;
    try {
      await api(`/api/compliance/${item.id}/decision`, { method: "POST", body: JSON.stringify({ status, reason }) });
      setToast("Compliance decision recorded."); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Decision could not be saved"); }
  }

  async function uploadFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await api("/api/documents/upload", { method: "POST", body: data });
      form.reset(); setToast("Document uploaded and queued for authorised verification."); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed"); }
  }

  async function createApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setCreateError("");
    try {
      await api("/api/applications", {
        method: "POST",
        body: JSON.stringify({
          institution_id: form.get("institution_id"),
          application_type: form.get("application_type"),
          cycle: form.get("cycle"),
          workflow_version_id: form.get("workflow_version_id"),
          summary: form.get("summary"),
        }),
      });
      setCreateOpen(false); setToast("Application registered in the authorised scrutiny workflow."); await refresh();
    } catch (e) { setCreateError(e instanceof Error ? e.message : "Application could not be registered"); }
  }

  async function createWorkflowVersion(templateId: string, stages: string[]) {
    await api(`/api/workflows/${templateId}/versions`, { method: "POST", body: JSON.stringify({ stages }) });
    setToast("Validated workflow draft created."); await refresh();
  }

  async function publishWorkflowVersion(versionId: string) {
    const confirmed = window.confirm("Publish this validated route for new applications? Existing applications retain their recorded workflow version.");
    if (!confirmed) return;
    try {
      await api(`/api/workflow-versions/${versionId}/publish`, { method: "POST", body: "{}" });
      setToast("Workflow version published. Existing case routes remain unchanged."); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Workflow could not be published"); }
  }

  async function resolveEscalation(item: Escalation) {
    const reason = window.prompt("Record the follow-up action and resolution (min. 5 characters):");
    if (!reason) return;
    try {
      await api(`/api/escalations/${item.id}/resolve`, { method: "POST", body: JSON.stringify({ reason }) });
      setToast("Escalation resolution recorded in the audit trail."); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Escalation could not be resolved"); }
  }

  async function runDeadlineCheck() {
    try {
      const result = await api<{ notifications_created: number; escalations_created: number }>("/api/admin/run-deadline-check", { method: "POST", body: "{}" });
      setToast(`Deadline check complete · ${result.notifications_created} reminders and ${result.escalations_created} new escalations.`); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Deadline check could not run"); }
  }

  async function markNoticeRead(id: string) {
    try {
      await api(`/api/notifications/${id}/read`, { method: "POST", body: "{}" });
      await refresh();
    } catch { /* ignore */ }
  }

  async function markAllNoticesRead() {
    try {
      await api("/api/notifications/read-all", { method: "POST", body: "{}" });
      setToast("All notifications marked as read.");
      await refresh();
    } catch { /* ignore */ }
  }

  async function downloadReport() {
    try {
      const response = await fetch(`${apiBaseUrl()}/api/reports/applications.csv`, { credentials: "include" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail ?? `Export failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = "authorised-applications.csv"; link.click();
      URL.revokeObjectURL(url);
      setToast("Authorised application report downloaded.");
    } catch (e) { setError(e instanceof Error ? e.message : "Report could not be downloaded"); }
  }

  async function submitCompliance(item: Compliance) {
    const evidenceName = window.prompt("Enter the evidence document name or upload reference:");
    if (!evidenceName) return;
    const submissionNote = window.prompt("Add a submission note (optional):") ?? "";
    try {
      await api(`/api/compliance/${item.id}/submit`, {
        method: "POST", body: JSON.stringify({ evidence_name: evidenceName, submission_note: submissionNote }),
      });
      setToast("Evidence submitted for authorised human verification."); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Submission could not be saved"); }
  }

  async function scheduleEvc(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setEvcError("");
    try {
      const localDate = String(form.get("scheduled_at"));
      await api("/api/evc", {
        method: "POST",
        body: JSON.stringify({
          application_id: form.get("application_id"),
          scheduled_at: new Date(localDate).toISOString(),
          location: form.get("location"),
          committee: form.get("committee"),
          reason: form.get("reason"),
        }),
      });
      setEvcOpen(false); setToast("EVC visit scheduled and recorded in the audit trail."); await refresh();
    } catch (e) { setEvcError(e instanceof Error ? e.message : "Visit could not be scheduled"); }
  }

  if (!user) {
    return (
      <main className="login-screen">
        <section className="login-brand">
          <div className="brand-mark"><ShieldCheck size={28} /></div>
          <div className="brand-kicker">AICTE · PROBLEM STATEMENT 26262</div>
          <h1>Integrated approval workflow.<br /><em>With full compliance intelligence.</em></h1>
          <p>Automated workflow routing, scrutiny checklists, EVC scheduling, undertakings monitoring and persistent deadline escalation.</p>
          <div className="login-assurance"><ShieldCheck size={16} /> Authorised access · auditable actions · human-led statutory decisions</div>
          <div className="login-watermark">DEMONSTRATION PROTOTYPE · SYNTHETIC DATA</div>
        </section>
        <section className="login-panel">
          <div className="login-mobile-brand"><span className="brand-mark"><ShieldCheck size={22} /></span><b>AICTE Operations</b></div>
          <div className="login-form-wrap">
            <div className="eyebrow">ONE-CLICK DEMO PERSONA SWITCHER</div>
            <h2>Select persona or sign in</h2>
            <p className="muted">Test any of the 6 official user roles defined in the AICTE problem statement:</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "20px" }}>
              {DEMO_PERSONAS.map((p) => (
                <button
                  key={p.role}
                  className="persona-pill"
                  onClick={() => void switchDemoPersona(p.email)}
                  type="button"
                >
                  <i /> {p.title}
                </button>
              ))}
            </div>

            {error && <div className="error-box">{error}</div>}
            <form className="login-form" onSubmit={signIn}>
              <label>Email address<input type="email" autoComplete="username" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} required /></label>
              <label>Password<input type="password" autoComplete="current-password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} required /></label>
              <button className="primary-btn full" disabled={loading}>{loading ? "Checking access…" : "Sign in"} <ArrowRight size={17} /></button>
            </form>
            <div className="demo-account"><span>DEFAULT PASSWORD</span><strong>DemoPass!2026</strong><small>Applicable to all seeded demonstration accounts.</small></div>
            <p className="legal-note">Demonstration environment with synthetic data. Not connected to official production AICTE databases.</p>
          </div>
        </section>
      </main>
    );
  }

  const count = dashboard?.counts ?? {};
  const roleIsInstitution = user.role === "institution";

  return (
    <div className="app-shell">
      {/* Quick Demo Persona Switcher Bar */}
      <div className="persona-switcher-bar">
        <strong>Demo Persona:</strong>
        {DEMO_PERSONAS.map((p) => (
          <button
            key={p.role}
            className={`persona-pill ${user.email === p.email ? "active" : ""}`}
            onClick={() => void switchDemoPersona(p.email)}
            title={`Switch to ${p.name} (${p.title})`}
          >
            <i /> {p.title}
          </button>
        ))}
      </div>

      {mobileMenu && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileMenu(false)} />}
      <aside className={`sidebar ${mobileMenu ? "open" : ""}`} style={{ top: "34px" }}>
        <div className="sidebar-brand"><div className="brand-mark"><ShieldCheck size={23} /></div><div><b>AICTE</b><span>APPROVAL OPERATIONS</span></div><button className="close-nav" onClick={() => setMobileMenu(false)} aria-label="Close menu"><X size={18} /></button></div>
        <div className="environment-pill"><span /> DEMONSTRATION · SYNTHETIC</div>
        <div className="nav-caption">WORKSPACE</div>
        <nav className="side-nav">
          {nav.filter((item) => item.id !== "audit" || !["institution", "evc_member", "scrutiny_officer"].includes(user.role))
            .filter((item) => item.id !== "evc" || ["super_admin", "central_officer", "regional_officer", "evc_member"].includes(user.role))
            .filter((item) => item.id !== "workflows" || user.role === "super_admin")
            .filter((item) => item.id !== "escalations" || ["super_admin", "central_officer", "regional_officer", "competent_authority"].includes(user.role))
            .filter((item) => item.id !== "reports" || ["super_admin", "central_officer", "regional_officer", "competent_authority"].includes(user.role))
            .map((item) => <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => { setPage(item.id); setMobileMenu(false); }}>
              <item.icon size={18} strokeWidth={1.8} /><span>{item.label}</span>{item.id === "notifications" && notices.some((n) => !n.read_at) && <i className="nav-dot" />}
            </button>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="nav-caption">SYSTEM STATUS</div>
          <div className="system-status"><span className="status-pulse" /> All services operational</div>
          <div className="side-version">Workflow engine v1.0 · Active<br />Role: {roleLabels[user.role] ?? user.role}</div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <button className="menu-toggle" onClick={() => setMobileMenu(true)} aria-label="Open navigation"><Menu size={20} /></button>
          <div className="breadcrumbs"><span>AICTE</span><b>/</b><strong>{nav.find((item) => item.id === page)?.label ?? "Workspace"}</strong></div>
          <div className="topbar-right">
            <label className="global-search"><Search size={16} /><input placeholder="Search applications…" value={query} onChange={(e) => { setQuery(e.target.value); if (page !== "applications") setPage("applications"); }} /><kbd>⌘ K</kbd></label>
            <button className="icon-button" aria-label="Notifications" onClick={() => setPage("notifications")}><Bell size={19} />{notices.some((item) => !item.read_at) && <i />}</button>
            <div className="user-menu"><div className="avatar">{initials(user.name)}</div><div className="user-meta"><strong>{user.name}</strong><span>{roleLabels[user.role] ?? user.role}</span></div><button onClick={signOut} title="Sign out"><LogOut size={16} /></button></div>
          </div>
        </header>
        <div className="page-content">
          <div className="demo-banner"><ShieldCheck size={15} /><span><b>Demonstration environment</b> — all institutions, applications and deadlines are synthetic; this is not an official AICTE system.</span></div>
          {error && <div className="error-box page-error"><AlertTriangle size={17} />{error}<button onClick={() => setError("")} aria-label="Dismiss error"><X size={16} /></button></div>}
          {loading && !dashboard ? <div className="loading-panel"><span className="loader" />Loading authorised workspace data…</div> : null}

          {page === "dashboard" && <DashboardView dashboard={dashboard} user={user} onOpenApplications={() => setPage("applications")} onSelect={(item) => setSelected(item)} />}
          {page === "applications" && <ApplicationsView rows={filteredApps} query={query} setQuery={setQuery} stageFilter={stageFilter} setStageFilter={setStageFilter} onSelect={setSelected} onCreate={() => setCreateOpen(true)} canCreate={["institution", "super_admin", "central_officer", "regional_officer"].includes(user.role)} />}
          {page === "institutions" && <InstitutionProfileView institutions={institutions} applications={apps} compliance={compliance} documents={documents} onSelect={setSelected} />}
          {page === "reports" && <ReportView summary={reportSummary} onExport={downloadReport} />}
          {page === "evc" && <EvcView rows={evc} applications={apps} canSchedule={["super_admin", "central_officer", "regional_officer"].includes(user.role)} onSchedule={() => setEvcOpen(true)} onOpenReport={(row) => { setSelectedEvc(row); setEvcReportOpen(true); }} canReport={["evc_member", "central_officer", "regional_officer", "super_admin"].includes(user.role)} />}
          {page === "compliance" && <ComplianceView rows={compliance} institution={roleIsInstitution} canReview={["super_admin", "central_officer", "regional_officer", "scrutiny_officer"].includes(user.role)} onDecision={decideCompliance} onSubmit={submitCompliance} />}
          {page === "documents" && <DocumentsView rows={documents} institutionId={user.institution_id ?? ""} institutions={institutions} canUpload={["institution", "super_admin", "central_officer", "regional_officer"].includes(user.role)} canVerify={["super_admin", "central_officer", "regional_officer", "scrutiny_officer"].includes(user.role)} onUpload={uploadFile} onRenew={(doc) => { setSelectedDoc(doc); setRenewOpen(true); }} onDecision={async (item, status) => {
            const reason = window.prompt(`Reason for marking this document "${status}":`);
            if (!reason) return;
            try {
              await api(`/api/documents/${item.id}/decision`, { method: "POST", body: JSON.stringify({ status, reason }) });
              setToast("Document verification outcome recorded."); await refresh();
            } catch (e) { setError(e instanceof Error ? e.message : "Document decision could not be saved"); }
          }} />}
          {page === "escalations" && <EscalationsView rows={escalations} canRun={user.role === "super_admin"} onRun={runDeadlineCheck} onResolve={resolveEscalation} />}
          {page === "notifications" && <NotificationsView rows={notices} onMarkRead={markNoticeRead} onMarkAllRead={markAllNoticesRead} />}
          {page === "audit" && <AuditView rows={audit} />}
          {page === "workflows" && <WorkflowStudio versions={workflowVersions} onCreate={createWorkflowVersion} onPublish={publishWorkflowVersion} />}
        </div>
      </main>

      {/* Application Detail Drawer */}
      {selected && <div className="drawer-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
        <aside className="detail-drawer">
          <div className="drawer-head"><div><span className="eyebrow">APPLICATION RECORD</span><button className="icon-button close-drawer" onClick={() => setSelected(null)} aria-label="Close details"><X size={19} /></button></div>
            <h2>{selected.reference}</h2><p>{selected.institution_name}</p></div>
          <div className="drawer-body">
            <div className="drawer-status"><Badge>{selected.status}</Badge><span>Workflow stage · <b>{selected.stage}</b></span></div>
            <div className="detail-grid">
              <div><small>APPLICATION TYPE</small><b>{selected.application_type}</b></div>
              <div><small>ACADEMIC CYCLE</small><b>{selected.cycle}</b></div>
              <div><small>REGION</small><b>{selected.region}</b></div>
              <div><small>ASSIGNED TO</small><b>{selected.assignee}</b></div>
              <div><small>SUBMITTED</small><b>{date(selected.submitted_at)}</b></div>
              <div><small>CURRENT DUE DATE</small><b>{date(selected.due_at)}</b></div>
            </div>

            {selected.decision_notes && (
              <section className="drawer-section" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "12px", borderRadius: "5px" }}>
                <h3 style={{ color: "#166534", margin: "0 0 5px" }}>Official Statutory Decision</h3>
                <p style={{ color: "#15803d", margin: 0, fontSize: "11px" }}><b>Status:</b> {selected.status} · Recorded {date(selected.decision_at)}</p>
                <p style={{ color: "#166534", margin: "6px 0 0", fontSize: "10px" }}><b>Reasoning / Order:</b> {selected.decision_notes}</p>
              </section>
            )}

            <section className="drawer-section">
              <h3>Case summary</h3>
              <p>{selected.summary || "No summary recorded."}</p>
            </section>

            {/* Scrutiny Observations Section */}
            <section className="drawer-section">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3>Scrutiny Observations ({observations.length})</h3>
                {["scrutiny_officer", "regional_officer", "central_officer", "super_admin"].includes(user.role) && (
                  <button className="text-link" onClick={() => setObservationOpen(true)}>+ Add Observation</button>
                )}
              </div>
              <div className="observation-list">
                {observations.map((obs) => (
                  <div key={obs.id} className="observation-item">
                    <div className="observation-head">
                      <b>{obs.category}</b>
                      <Badge>{obs.status}</Badge>
                    </div>
                    <p className="observation-body">{obs.finding}</p>
                    <small style={{ color: "#9ca3af", fontSize: "9px" }}>Recorded by {obs.officer_name} · {date(obs.created_at)}</small>
                  </div>
                ))}
                {!observations.length && <div className="empty-inline" style={{ margin: "5px 0" }}>No scrutiny observations recorded yet.</div>}
              </div>
            </section>

            <section className="drawer-section">
              <h3>Available case actions</h3>
              <p className="muted">Transitions are validated against the active stage, role permissions, and institution scope.</p>
              <div className="action-stack">
                {/* Scrutiny stage actions */}
                {selected.stage === "Scrutiny" && ["scrutiny_officer", "regional_officer", "central_officer", "super_admin"].includes(user.role) && (
                  <>
                    <button className="outline-action danger-action" onClick={() => doTransition("return")}>
                      Return for correction
                    </button>
                    <button className="primary-btn" onClick={() => doTransition("complete")}>
                      Complete scrutiny <ArrowRight size={16} />
                    </button>
                  </>
                )}

                {/* Institution correction resubmit */}
                {selected.stage === "Correction" && user.role === "institution" && (
                  <button className="primary-btn" onClick={() => doTransition("resubmit")}>
                    Resubmit correction <ArrowRight size={16} />
                  </button>
                )}

                {/* EVC stage actions */}
                {selected.stage === "EVC" && ["evc_member", "central_officer", "regional_officer", "super_admin"].includes(user.role) && (
                  <button className="primary-btn" onClick={() => doTransition("complete")}>
                    Advance from EVC stage <ArrowRight size={16} />
                  </button>
                )}

                {/* Committee review / Competent Authority decisions */}
                {selected.stage === "Committee review" && ["competent_authority", "central_officer", "super_admin"].includes(user.role) && (
                  <button className="primary-btn" style={{ background: "#166534", borderColor: "#166534" }} onClick={() => setDecisionOpen(true)}>
                    Record Statutory Decision <CheckCircle2 size={16} />
                  </button>
                )}

                {!((selected.stage === "Scrutiny" && user.role !== "institution") ||
                   (selected.stage === "Correction" && user.role === "institution") ||
                   (selected.stage === "EVC" && user.role !== "institution") ||
                   (selected.stage === "Committee review" && ["competent_authority", "central_officer", "super_admin"].includes(user.role))) && (
                  <div className="empty-inline">No action is currently pending for your role at this stage.</div>
                )}
              </div>
            </section>

            <button className="outline-action" onClick={async () => {
              try {
                const events = await api<{ action: string; to_stage: string; reason: string; actor: string; created_at: string }[]>(`/api/applications/${selected.id}/timeline`);
                window.alert(events.map((item) => `${date(item.created_at)} · ${item.actor} · ${item.action} → ${item.to_stage}\n${item.reason}`).join("\n\n") || "No timeline events.");
              } catch (e) { setError(e instanceof Error ? e.message : "Timeline could not be loaded"); }
            }}>View workflow audit timeline <ArrowRight size={15} /></button>
          </div>
        </aside>
      </div>}

      {/* Statutory Decision Modal */}
      {decisionOpen && selected && (
        <div className="modal-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) setDecisionOpen(false); }}>
          <section className="create-modal" style={{ width: "min(560px, 100%)" }}>
            <div className="modal-heading">
              <div>
                <span className="eyebrow">COMPETENT AUTHORITY POWERS</span>
                <h2>Record Statutory Decision</h2>
                <p>Application: <b>{selected.reference}</b> · {selected.institution_name}</p>
              </div>
              <button className="icon-button" onClick={() => setDecisionOpen(false)}><X size={18} /></button>
            </div>

            {decisionError && <div className="error-box">{decisionError}</div>}

            <form className="create-form" onSubmit={submitDecision}>
              <div className="decision-options">
                <label className={`decision-option ${decisionDecision === "approve" ? "selected" : ""}`}>
                  <input type="radio" name="decision" checked={decisionDecision === "approve"} onChange={() => setDecisionDecision("approve")} />
                  <div>
                    <b>Grant Full Approval</b>
                    <span>Application satisfies all scrutiny norms and committee requirements.</span>
                  </div>
                </label>
                <label className={`decision-option ${decisionDecision === "approve_with_undertaking" ? "selected" : ""}`}>
                  <input type="radio" name="decision" checked={decisionDecision === "approve_with_undertaking"} onChange={() => setDecisionDecision("approve_with_undertaking")} />
                  <div>
                    <b>Grant Conditional Approval (with Time-bound Undertakings)</b>
                    <span>Approved subject to fulfilment of mandatory conditions and verification of undertakings.</span>
                  </div>
                </label>
                <label className={`decision-option ${decisionDecision === "reject" ? "selected" : ""}`}>
                  <input type="radio" name="decision" checked={decisionDecision === "reject"} onChange={() => setDecisionDecision("reject")} />
                  <div>
                    <b>Reject Application</b>
                    <span>Application fails to satisfy statutory requirements or deficiencies were not remediated.</span>
                  </div>
                </label>
              </div>

              <label>
                Formal Justification & Order Summary (Mandatory)
                <textarea
                  rows={3}
                  required
                  minLength={10}
                  value={decisionReason}
                  onChange={(e) => setDecisionReason(e.target.value)}
                  placeholder="Record the official statutory order, referencing findings of scrutiny and committee reports."
                />
              </label>

              {decisionDecision === "approve_with_undertaking" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                    <label style={{ margin: 0 }}>Mandated Compliance Undertakings</label>
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => setUndertakingRows([...undertakingRows, { title: "", due_in_days: 30 }])}
                    >
                      + Add Undertaking
                    </button>
                  </div>
                  {undertakingRows.map((u, i) => (
                    <div key={i} className="undertaking-row">
                      <input
                        placeholder="Undertaking condition description"
                        value={u.title}
                        required
                        onChange={(e) => {
                          const val = e.target.value;
                          setUndertakingRows(rows => rows.map((r, idx) => idx === i ? { ...r, title: val } : r));
                        }}
                      />
                      <input
                        type="number"
                        placeholder="Days (e.g. 30)"
                        value={u.due_in_days}
                        required
                        min={1}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setUndertakingRows(rows => rows.map((r, idx) => idx === i ? { ...r, due_in_days: val } : r));
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="modal-actions">
                <button type="button" className="outline-action" onClick={() => setDecisionOpen(false)}>Cancel</button>
                <button className="primary-btn" style={{ background: decisionDecision === "reject" ? "#dc2626" : "#166534", borderColor: "transparent" }}>
                  Confirm Statutory Order <Check size={16} />
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* Scrutiny Observation Modal */}
      {observationOpen && selected && (
        <div className="modal-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) setObservationOpen(false); }}>
          <section className="create-modal">
            <div className="modal-heading">
              <div>
                <span className="eyebrow">SCRUTINY WORKSPACE</span>
                <h2>Record Scrutiny Observation</h2>
                <p>For application {selected.reference}</p>
              </div>
              <button className="icon-button" onClick={() => setObservationOpen(false)}><X size={18} /></button>
            </div>
            {obsError && <div className="error-box">{obsError}</div>}
            <form className="create-form" onSubmit={submitObservation}>
              <label>
                Category
                <select value={obsCategory} onChange={(e) => setObsCategory(e.target.value)}>
                  <option>Land & Infrastructure Norms</option>
                  <option>Faculty Cadre & Qualifications</option>
                  <option>Financial Soundness & Endowment</option>
                  <option>Fire Safety & Environmental NOC</option>
                  <option>Curriculum & Laboratory Facilities</option>
                </select>
              </label>
              <label>
                Observation Finding Status
                <select value={obsStatus} onChange={(e) => setObsStatus(e.target.value)}>
                  <option value="Satisfactory">Satisfactory (Meets AICTE Norms)</option>
                  <option value="Deficient">Deficient (Requires Correction)</option>
                </select>
              </label>
              <label>
                Detailed Observation Notes
                <textarea
                  rows={3}
                  required
                  minLength={5}
                  value={obsFinding}
                  onChange={(e) => setObsFinding(e.target.value)}
                  placeholder="Record specific findings from document verification."
                />
              </label>
              <div className="modal-actions">
                <button type="button" className="outline-action" onClick={() => setObservationOpen(false)}>Cancel</button>
                <button className="primary-btn">Save Observation <Check size={16} /></button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* EVC Inspection Report Modal */}
      {evcReportOpen && selectedEvc && (
        <div className="modal-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) setEvcReportOpen(false); }}>
          <section className="create-modal">
            <div className="modal-heading">
              <div>
                <span className="eyebrow">EXPERT VISIT REPORT</span>
                <h2>Submit Committee Findings</h2>
                <p>Visit: <b>{selectedEvc.reference}</b> · {selectedEvc.committee}</p>
              </div>
              <button className="icon-button" onClick={() => setEvcReportOpen(false)}><X size={18} /></button>
            </div>
            {evcReportError && <div className="error-box">{evcReportError}</div>}
            <form className="create-form" onSubmit={submitEvcReport}>
              <label>
                Committee Recommendation
                <select value={evcRecommendation} onChange={(e) => setEvcRecommendation(e.target.value)}>
                  <option value="Recommended">Recommended for Approval</option>
                  <option value="Conditional">Conditional (Subject to Rectification)</option>
                  <option value="Not Recommended">Not Recommended</option>
                </select>
              </label>
              <label>
                Physical Inspection Findings & Observations
                <textarea
                  rows={4}
                  required
                  minLength={10}
                  value={evcReportNotes}
                  onChange={(e) => setEvcReportNotes(e.target.value)}
                  placeholder="Record verification of physical facilities, equipment, laboratories, and interaction with faculty."
                />
              </label>
              <div className="modal-actions">
                <button type="button" className="outline-action" onClick={() => setEvcReportOpen(false)}>Cancel</button>
                <button className="primary-btn">Submit Report & Advance Case <Send size={16} /></button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* Renew Document Modal */}
      {renewOpen && selectedDoc && (
        <div className="modal-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) setRenewOpen(false); }}>
          <section className="create-modal">
            <div className="modal-heading">
              <div>
                <span className="eyebrow">DOCUMENT LIFECYCLE</span>
                <h2>Submit Renewed Document</h2>
                <p>{selectedDoc.category} · current version {selectedDoc.version_number ?? 1}</p>
              </div>
              <button className="icon-button" onClick={() => setRenewOpen(false)}><X size={18} /></button>
            </div>
            {renewError && <div className="error-box">{renewError}</div>}
            <form className="create-form" onSubmit={submitRenewDocument}>
              <label>
                New Expiry Date
                <input name="expires_at" type="date" required />
              </label>
              <label className="file-input-label">
                Upload Renewed File (PDF, PNG, JPEG)
                <input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg" required />
              </label>
              <div className="modal-actions">
                <button type="button" className="outline-action" onClick={() => setRenewOpen(false)}>Cancel</button>
                <button className="primary-btn">Submit Renewal <ArrowRight size={16} /></button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* Intake / Create Application Modal */}
      {createOpen && <div className="modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateOpen(false); }}>
        <section className="create-modal"><div className="modal-heading"><div><span className="eyebrow">APPLICATION INTAKE</span><h2>Register an application</h2><p>Creates a submission in the configured demonstration workflow route.</p></div><button className="icon-button" onClick={() => setCreateOpen(false)} aria-label="Close"><X size={18} /></button></div>
          {createError && <div className="error-box">{createError}</div>}
          <form className="create-form" onSubmit={createApplication}>
            <label>Institution<select name="institution_id" defaultValue={user.institution_id ?? institutions[0]?.id ?? ""} required disabled={roleIsInstitution}><option value="" disabled>Select institution</option>{institutions.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</select></label>
            <label>Application type<select name="application_type" required><option>Extension of Approval</option><option>New Institution</option><option>Increase in Intake</option><option>New Programme</option></select></label>
            <label>Academic cycle<input name="cycle" defaultValue="2026-27" required /></label>
            <label>Published workflow route<select name="workflow_version_id" defaultValue={workflowTemplates[0]?.workflow_version_id ?? ""} required><option value="" disabled>Select a published workflow</option>{workflowTemplates.map((item) => <option key={item.workflow_version_id} value={item.workflow_version_id}>{item.name} · v{item.version} ({item.stages.join(" → ")})</option>)}</select></label>
            <label>Case summary<textarea name="summary" rows={3} placeholder="Briefly describe the submission." /></label>
            <div className="modal-actions"><button type="button" className="outline-action" onClick={() => setCreateOpen(false)}>Cancel</button><button className="primary-btn">Submit to workflow <ArrowRight size={15} /></button></div>
          </form>
        </section>
      </div>}

      {/* Schedule EVC Modal */}
      {evcOpen && <div className="modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) setEvcOpen(false); }}>
        <section className="create-modal"><div className="modal-heading"><div><span className="eyebrow">EVC CALENDAR</span><h2>Schedule an expert visit</h2><p>Only eligible applications at the EVC stage can be scheduled.</p></div><button className="icon-button" onClick={() => setEvcOpen(false)} aria-label="Close"><X size={18} /></button></div>
          {evcError && <div className="error-box">{evcError}</div>}
          <form className="create-form" onSubmit={scheduleEvc}>
            <label>Eligible application<select name="application_id" required defaultValue=""><option value="" disabled>Select application</option>{apps.filter((item) => item.stage === "EVC").map((item) => <option key={item.id} value={item.id}>{item.reference} · {item.institution_name}</option>)}</select></label>
            <label>Visit date and time<input name="scheduled_at" type="datetime-local" required /></label>
            <label>Visit location<input name="location" required placeholder="City, State" /></label>
            <label>Committee assignment<input name="committee" required placeholder="e.g. Committee North-05" /></label>
            <label>Scheduling reason<textarea name="reason" rows={2} minLength={5} required placeholder="Record the scheduling rationale." /></label>
            <div className="modal-actions"><button type="button" className="outline-action" onClick={() => setEvcOpen(false)}>Cancel</button><button className="primary-btn">Schedule visit <CalendarDays size={15} /></button></div>
          </form>
        </section>
      </div>}

      {toast && <div className="toast"><Check size={17} />{toast}<button onClick={() => setToast("")}><X size={15} /></button></div>}
    </div>
  );
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function DashboardView({ dashboard, user, onOpenApplications, onSelect }: { dashboard: Dashboard | null; user: User; onOpenApplications: () => void; onSelect: (item: Application) => void }) {
  if (!dashboard) return null;
  const counts = dashboard.counts;
  const cards = [
    { label: user.role === "institution" ? "My applications" : "Total applications", value: counts.total_applications, icon: ClipboardList, tone: "navy", delta: "Across authorised scope" },
    { label: "In progress", value: counts.in_progress, icon: Activity, tone: "blue", delta: "Active workflow records" },
    { label: "Overdue cases", value: counts.overdue, icon: AlertTriangle, tone: "red", delta: "Requires timely follow-up" },
    { label: "Documents expiring", value: counts.documents_expiring, icon: FileText, tone: "amber", delta: "Within next 90 days" },
  ];
  const total = Math.max(1, dashboard.stage_distribution.reduce((sum, item) => sum + item.count, 0));
  const stageColors = ["#315ce8", "#f0a634", "#7e64d8", "#1c9a77", "#8090a8"];
  return <>
    <PageHeading eyebrow="OPERATIONS OVERVIEW" title={user.role === "institution" ? "Institution dashboard" : "Good day, " + user.name.split(" ")[0]} description={user.role === "institution" ? "Track your application progress, compliance undertakings and document validity." : "Centralised monitoring of application movement, scrutiny pendency and statutory milestones."} action={<button className="outline-action refresh-btn" onClick={() => window.location.reload()}><Activity size={15} /> Refresh data</button>} />
    <div className="metric-grid">{cards.map(({ label, value, icon: Icon, tone, delta }) => <button className="metric-card" key={label} onClick={onOpenApplications}>
      <span className={`metric-icon ${tone}`}><Icon size={19} /></span><span className="metric-label">{label}<ArrowDownRight size={14} /></span><strong>{value ?? 0}</strong><small>{delta}</small>
    </button>)}</div>
    <div className="dashboard-grid">
      <section className="panel stage-panel"><div className="panel-heading"><div><h2>Applications by stage</h2><p>Current authorised workload distribution</p></div><button className="text-link" onClick={onOpenApplications}>View registry <ArrowRight size={15} /></button></div>
        <div className="stage-layout"><div className="donut" style={{ background: `conic-gradient(${dashboard.stage_distribution.map((item, index) => `${stageColors[index % stageColors.length]} 0 ${(item.count / total) * 100}%`).join(", ")})` }}><div><strong>{counts.total_applications}</strong><span>applications</span></div></div>
          <div className="stage-legend">{dashboard.stage_distribution.map((item, index) => <div key={item.stage}><i style={{ backgroundColor: stageColors[index % stageColors.length] }} /><span>{item.stage}</span><b>{item.count}</b></div>)}</div></div>
        <div className="panel-footnote"><span className="info-dot">i</span> Metrics are calculated from persistent demonstration records.</div>
      </section>
      <section className="panel attention-panel"><div className="panel-heading"><div><h2>Attention required</h2><p>Upcoming and overdue actions</p></div><span className="attention-count">{(counts.overdue ?? 0) + (counts.obligations_due_soon ?? 0)}</span></div>
        <div className="attention-list">
          <div className="attention-item"><span className="attention-icon red"><AlertTriangle size={16} /></span><div><b>{counts.overdue ?? 0} overdue applications</b><small>Review against the recorded case deadline</small></div><ArrowRight size={15} /></div>
          <div className="attention-item"><span className="attention-icon amber"><Clock3 size={16} /></span><div><b>{counts.obligations_due_soon ?? 0} obligations due soon</b><small>Due within the next seven days</small></div><ArrowRight size={15} /></div>
          <div className="attention-item"><span className="attention-icon blue"><FileText size={16} /></span><div><b>{counts.documents_expiring ?? 0} documents nearing expiry</b><small>Review renewal status with the institution</small></div><ArrowRight size={15} /></div>
        </div>
        <div className="panel-footnote">Date calculations use UTC records; dates shown in your local time zone.</div>
      </section>
    </div>
    <section className="panel recent-panel"><div className="panel-heading"><div><h2>Recent applications</h2><p>Latest records within your authorised scope</p></div><button className="text-link" onClick={onOpenApplications}>All applications <ArrowRight size={15} /></button></div>
      <ApplicationTable rows={dashboard.applications} onSelect={onSelect} compact />
    </section>
    <div className="dashboard-footer"><span>Last data refresh · {new Date(dashboard.refreshed_at).toLocaleString()}</span><span><ShieldCheck size={14} /> Role-scoped view · {roleLabels[user.role] ?? user.role}</span></div>
  </>;
}

function ApplicationsView({ rows, query, setQuery, stageFilter, setStageFilter, onSelect, onCreate, canCreate }: {
  rows: Application[]; query: string; setQuery: (value: string) => void; stageFilter: string; setStageFilter: (value: string) => void;
  onSelect: (item: Application) => void; onCreate: () => void; canCreate: boolean;
}) {
  const stages = [...new Set(rows.map((item) => item.stage))];
  return <>
    <PageHeading eyebrow="CASE MANAGEMENT" title="Applications" description="Search, filter and open authorised application records." action={canCreate && <button className="primary-btn" onClick={onCreate}>Register application <ArrowRight size={16} /></button>} />
    <section className="panel registry-panel">
      <div className="registry-tools"><div className="registry-search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search reference, institution or type…" /></div>
        <label className="filter-select"><span>STAGE</span><select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}><option value="">All stages</option>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select><ChevronDown size={15} /></label>
        <button className="outline-action compact-action" onClick={() => { setQuery(""); setStageFilter(""); }}>Clear filters</button>
      </div>
      <div className="table-summary"><span><b>{rows.length}</b> records</span><span>Sorted by latest submission</span></div>
      <ApplicationTable rows={rows} onSelect={onSelect} />
      {!rows.length && <div className="empty-state"><Search size={25} /><b>No matching applications</b><span>Try adjusting your search or stage filter.</span></div>}
    </section>
  </>;
}

function ApplicationTable({ rows, onSelect, compact = false }: { rows: Application[]; onSelect: (item: Application) => void; compact?: boolean }) {
  return <div className="table-wrap"><table className="data-table"><thead><tr><th>APPLICATION</th><th>INSTITUTION</th><th>STAGE</th><th>ASSIGNED TO</th><th>DUE DATE</th><th>STATUS</th><th /></tr></thead>
    <tbody>{rows.map((item) => <tr key={item.id} onClick={() => onSelect(item)} className="clickable-row">
      <td><b className="reference">{item.reference}</b><small>{item.application_type} · {item.cycle}</small></td><td><b>{item.institution_name}</b><small>{item.region}</small></td><td><span className="stage-cell"><span className="stage-marker" />{item.stage}</span></td>
      <td>{item.assignee}</td><td>{date(item.due_at)}</td><td><Badge>{item.status}</Badge></td><td><ArrowRight size={16} className="row-arrow" /></td>
    </tr>)}</tbody></table>{compact && !rows.length && <div className="empty-inline">No applications are available in this scope.</div>}</div>;
}

function EvcView({ rows, applications, canSchedule, onSchedule, onOpenReport, canReport }: {
  rows: Evc[]; applications: Application[]; canSchedule: boolean; onSchedule: () => void;
  onOpenReport: (row: Evc) => void; canReport: boolean;
}) {
  const eligible = applications.some((item) => item.stage === "EVC");
  return <>
    <PageHeading eyebrow="EXPERT VISIT COMMITTEE" title="EVC workspace" description="Review scheduled inspection visits, submit committee findings and monitor recommendations." action={canSchedule && <button className="primary-btn" onClick={onSchedule} disabled={!eligible}>Schedule visit <CalendarDays size={15} /></button>} />
    <div className="metric-grid three-metrics">
      <div className="metric-card static"><span className="metric-icon blue"><CalendarDays size={19} /></span><span className="metric-label">Scheduled visits</span><strong>{rows.filter((item) => item.status === "Scheduled").length}</strong><small>Awaiting visit completion</small></div>
      <div className="metric-card static"><span className="metric-icon green"><FileCheck2 size={19} /></span><span className="metric-label">Reports submitted</span><strong>{rows.filter((item) => item.status === "Report submitted").length}</strong><small>Findings documented</small></div>
      <div className="metric-card static"><span className="metric-icon navy"><Users size={19} /></span><span className="metric-label">Assigned committees</span><strong>{new Set(rows.map((item) => item.committee)).size}</strong><small>Active committee groups</small></div>
    </div>
    <section className="panel"><div className="panel-heading"><div><h2>Visit schedule & reports</h2><p>Visits and assignments in authorised scope</p></div><span className="synthetic-label">SYNTHETIC RECORDS</span></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>APPLICATION</th><th>INSTITUTION</th><th>VISIT DATE</th><th>LOCATION</th><th>COMMITTEE</th><th>STATUS</th><th>REPORT / ACTION</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}>
        <td><b className="reference">{item.reference}</b></td>
        <td>{item.institution_name}<small>{item.region}</small></td>
        <td>{date(item.scheduled_at)}</td>
        <td>{item.location}</td>
        <td>{item.committee}</td>
        <td><Badge>{item.status}</Badge></td>
        <td>
          {item.status === "Scheduled" && canReport ? (
            <button className="outline-action compact-action" onClick={() => onOpenReport(item)}>Submit report <Send size={13} /></button>
          ) : item.recommendation ? (
            <span title={item.report_notes || ""}><strong>{item.recommendation}</strong></span>
          ) : "—"}
        </td>
      </tr>)}</tbody></table></div>
      {!rows.length && <div className="empty-state"><CalendarDays size={26} /><b>No scheduled visits</b><span>Eligible applications will appear after an authorised schedule is created.</span></div>}
    </section>
  </>;
}

function ComplianceView({ rows, institution, canReview, onDecision, onSubmit }: { rows: Compliance[]; institution: boolean; canReview: boolean; onDecision: (item: Compliance, status: string) => void; onSubmit: (item: Compliance) => void }) {
  return <>
    <PageHeading eyebrow="APPROVAL CONDITIONS & UNDERTAKINGS" title="Compliance registry" description="Track time-bound undertakings and regulatory conditions separately from statutory verification." />
    <div className="metric-grid three-metrics"><div className="metric-card static"><span className="metric-icon blue"><BookOpenCheck size={18} /></span><span className="metric-label">Total obligations</span><strong>{rows.length}</strong><small>Across authorised scope</small></div><div className="metric-card static"><span className="metric-icon amber"><Clock3 size={18} /></span><span className="metric-label">Awaiting action</span><strong>{rows.filter((row) => !["Verified", "Closed"].includes(row.status)).length}</strong><small>Submission or review required</small></div><div className="metric-card static"><span className="metric-icon red"><AlertTriangle size={18} /></span><span className="metric-label">Overdue</span><strong>{rows.filter((row) => row.status === "Overdue").length}</strong><small>Needs follow-up</small></div></div>
    <section className="panel"><div className="panel-heading"><div><h2>Obligations and undertakings</h2><p>Current status and due dates</p></div><span className="synthetic-label">DEMO DATES</span></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>OBLIGATION</th><th>INSTITUTION</th><th>LINKED CASE</th><th>DUE DATE</th><th>STATUS</th>{(institution || canReview) && <th>{institution ? "SUBMISSION" : "REVIEW ACTION"}</th>}</tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td><b>{item.title}</b><small>{item.notes || "Evidence is subject to human verification"}</small></td><td>{item.institution_name}<small>{item.region}</small></td><td>{item.application_id ?? "Institution-level"}</td><td>{date(item.due_at)}</td><td><Badge>{item.status}</Badge></td>{(institution || canReview) && <td>{institution ? <button className="mini-action" disabled={["Verified", "Closed"].includes(item.status)} title="Submit evidence reference" onClick={() => onSubmit(item)}><FileCheck2 size={15} /></button> : <div className="table-actions"><button className="mini-action" title="Mark verified" onClick={() => onDecision(item, "Verified")}><Check size={15} /></button><button className="mini-action warn" title="Request correction" onClick={() => onDecision(item, "Correction required")}><AlertTriangle size={15} /></button></div>}</td>}</tr>)}</tbody></table></div>
      {!rows.length && <div className="empty-state"><BookOpenCheck size={25} /><b>No obligations found</b><span>There are no compliance obligations in this authorised scope.</span></div>}
    </section>
  </>;
}

function DocumentsView({ rows, institutionId, institutions, canUpload, canVerify, onUpload, onDecision, onRenew }: {
  rows: DocumentRow[]; institutionId: string; institutions: Institution[]; canUpload: boolean; canVerify: boolean;
  onUpload: (event: FormEvent<HTMLFormElement>) => void; onDecision: (item: DocumentRow, status: string) => void;
  onRenew: (doc: DocumentRow) => void;
}) {
  return <>
    <PageHeading eyebrow="LEASE & STATUTORY DOCUMENTS" title="Document validity & renewals" description="Multi-dimensional tracking of lease agreements, NOCs and validity dates. Expiry warnings fire 90, 30 and 7 days prior." />
    {canUpload && <section className="panel upload-panel"><div className="panel-heading"><div><h2>Submit a document</h2><p>Files are stored privately and validated against allowed signatures.</p></div><span className="upload-limit">PDF, PNG or JPEG · max 10 MB</span></div>
      <form className="upload-form" onSubmit={onUpload}>{institutionId ? <input type="hidden" name="institution_id" value={institutionId} /> : <label>Institution<select name="institution_id" required defaultValue=""><option value="" disabled>Select institution</option>{institutions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<label>Document category<input name="category" required placeholder="e.g. Registered Land Lease Deed" /></label><label>Expiry date <span>(optional)</span><input name="expires_at" type="date" /></label><label className="file-input-label">Select file<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg" required /></label><button className="primary-btn" type="submit">Upload for review <ArrowRight size={15} /></button></form>
    </section>}
    <section className="panel"><div className="panel-heading"><div><h2>Institutional documents</h2><p>{rows.length} records · ordered by expiry date</p></div><span className="synthetic-label">PRIVATE REGISTRY</span></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>DOCUMENT</th><th>INSTITUTION</th><th>EXPIRY</th><th>TIME REMAINING</th><th>VERSION</th><th>VERIFICATION</th><th>ACTION</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td><div className="document-cell"><span><FileText size={17} /></span><div><b>{item.category}</b><small>{item.file_name}</small></div></div></td><td>{item.institution_name}</td><td>{date(item.expires_at)}</td><td>{item.days_to_expiry === null ? "Not recorded" : item.days_to_expiry < 0 ? <strong className="text-red">Expired {Math.abs(item.days_to_expiry)} days ago</strong> : `${item.days_to_expiry} days`}</td><td><span className="version-tag">v{item.version_number ?? 1}</span></td><td><Badge>{item.status}</Badge></td><td>
        <div className="table-actions">
          {canVerify && <button className="mini-action" title="Verify document" onClick={() => onDecision(item, "Verified")}><Check size={15} /></button>}
          <button className="mini-action warn" title="Upload renewed version" onClick={() => onRenew(item)}><RefreshCw size={14} /></button>
        </div>
      </td></tr>)}</tbody></table></div>
      {!rows.length && <div className="empty-state"><FileText size={25} /><b>No documents registered</b><span>Documents submitted by authorised users appear here.</span></div>}
    </section>
  </>;
}

function NotificationsView({ rows, onMarkRead, onMarkAllRead }: { rows: Notice[]; onMarkRead: (id: string) => void; onMarkAllRead: () => void }) {
  const unreadCount = rows.filter((item) => !item.read_at).length;
  return <>
    <PageHeading
      eyebrow="INTELLIGENT ALERT CENTRE"
      title="Notifications & alerts"
      description="Persistent database alerts dispatched by the background deadline and compliance engine."
      action={unreadCount > 0 ? <button className="outline-action" onClick={onMarkAllRead}>Mark all as read</button> : undefined}
    />
    <section className="panel notification-panel">
      <div className="panel-heading"><div><h2>Notification centre</h2><p>{unreadCount} unread · {rows.length} total</p></div><Bell size={19} className="heading-icon" /></div>
      {rows.map((item) => <article className="notification-row" key={item.id} style={{ opacity: item.read_at ? 0.75 : 1 }}>
        <span className="notification-icon"><Bell size={16} /></span>
        <div style={{ flex: 1 }}>
          <div className="notification-title">{item.title}<Badge>{item.category.replaceAll("_", " ")}</Badge></div>
          <p>{item.body}</p>
          <small>{date(item.created_at)}</small>
        </div>
        {!item.read_at && (
          <button className="mini-action" title="Mark as read" onClick={() => onMarkRead(item.id)}>
            <Check size={14} />
          </button>
        )}
      </article>)}
      {!rows.length && <div className="empty-state"><Bell size={25} /><b>You’re all caught up</b><span>New reminders and case updates will appear here.</span></div>}
    </section>
  </>;
}

function AuditView({ rows }: { rows: AuditRow[] }) {
  return <>
    <PageHeading eyebrow="STATUTORY ACCOUNTABILITY" title="Audit trail" description="Immutable append-only record of all case actions, statutory decisions and compliance verifications." action={<span className="audit-lock"><ShieldCheck size={15} /> READ ONLY</span>} />
    <section className="panel"><div className="panel-heading"><div><h2>Recent activity</h2><p>Most recent 200 events · timestamps stored in UTC</p></div><span className="synthetic-label">IMMUTABLE EVENTS</span></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>ACTOR</th><th>ACTION</th><th>RECORD</th><th>REASON / CONTEXT</th><th>TIMESTAMP</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td><div className="actor-cell"><span>{initials(item.actor)}</span><b>{item.actor}</b></div></td><td><Badge>{item.action}</Badge></td><td><span className="reference">{item.entity_type}</span><small>{item.entity_id}</small></td><td className="audit-reason">{item.reason || "—"}</td><td>{new Date(item.created_at).toLocaleString()}</td></tr>)}</tbody></table></div>
      {!rows.length && <div className="empty-state"><Activity size={25} /><b>No audit activity yet</b><span>Recorded actions will appear here as the workflow progresses.</span></div>}
    </section>
  </>;
}

function WorkflowStudio({ versions, onCreate, onPublish }: {
  versions: WorkflowVersion[];
  onCreate: (templateId: string, stages: string[]) => Promise<void>;
  onPublish: (versionId: string) => Promise<void>;
}) {
  const [templateId, setTemplateId] = useState(versions[0]?.template_id ?? "");
  const [includeEvc, setIncludeEvc] = useState(true);
  const [includeCommittee, setIncludeCommittee] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const templates = [...new Map(versions.map((version) => [version.template_id, version.template_name])).entries()];

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setWorking(true);
    const stages = ["Scrutiny", ...(includeEvc ? ["EVC"] : []), ...(includeCommittee ? ["Committee review"] : []), "Completed"];
    try { await onCreate(templateId, stages); }
    catch (e) { setError(e instanceof Error ? e.message : "Workflow draft could not be created"); }
    finally { setWorking(false); }
  }

  async function publish(id: string) {
    setError(""); setWorking(true);
    try { await onPublish(id); }
    catch (e) { setError(e instanceof Error ? e.message : "Workflow could not be published"); }
    finally { setWorking(false); }
  }

  return <>
    <PageHeading eyebrow="ADMINISTRATION" title="Workflow configuration studio" description="Configure rule-driven stage sequences, deadlines and transition routes. Applications retain their assigned version." />
    <section className="panel workflow-create"><div className="panel-heading"><div><h2>Draft a workflow route</h2><p>Route names and stages must be verified against authorised requirements before publication.</p></div><span className="synthetic-label">ADMINISTRATOR ONLY</span></div>
      {error && <div className="error-box workflow-error">{error}</div>}
      <form className="workflow-form" onSubmit={createDraft}>
        <label>Workflow template<select value={templateId} onChange={(event) => setTemplateId(event.target.value)} required>{templates.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <fieldset><legend>Include stages in this sequence</legend><label className="locked-stage"><input type="checkbox" checked disabled /> Scrutiny <small>Required entry stage</small></label>
          <label><input type="checkbox" checked={includeEvc} onChange={(event) => setIncludeEvc(event.target.checked)} /> EVC <small>Expert visit stage</small></label>
          <label><input type="checkbox" checked={includeCommittee} onChange={(event) => setIncludeCommittee(event.target.checked)} /> Committee review <small>Committee recommendation</small></label>
          <label className="locked-stage"><input type="checkbox" checked disabled /> Completed <small>Required terminal stage</small></label>
        </fieldset>
        <div className="route-preview"><span>ROUTE PREVIEW</span><b>{["Scrutiny", ...(includeEvc ? ["EVC"] : []), ...(includeCommittee ? ["Committee review"] : []), "Completed"].join(" → ")}</b></div>
        <button className="primary-btn" disabled={working || !templateId}>Create validated draft <ArrowRight size={15} /></button>
      </form>
    </section>
    <section className="panel"><div className="panel-heading"><div><h2>Version history</h2><p>Historical audit trails remain intact across version publishing.</p></div><span className="synthetic-label">VERSIONED</span></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>TEMPLATE</th><th>VERSION</th><th>STAGES</th><th>STATUS</th><th>PUBLISHED</th><th>ACTION</th></tr></thead><tbody>{versions.map((item) => <tr key={item.id}><td><b>{item.template_name}</b></td><td>v{item.version}</td><td>{item.stages.join(" → ")}</td><td><Badge>{item.status}</Badge></td><td>{item.active_version_id === item.id ? "Active for new cases" : "Historical"}</td><td>{item.status === "Draft" ? <button className="mini-action" disabled={working} title="Publish validated draft" onClick={() => void publish(item.id)}><Check size={15} /></button> : "—"}</td></tr>)}</tbody></table></div>
      {!versions.length && <div className="empty-state"><Settings2 size={25} /><b>No workflow versions available</b><span>Seeded development routes appear here after API initialization.</span></div>}
    </section>
  </>;
}

function EscalationsView({ rows, canRun, onRun, onResolve }: { rows: Escalation[]; canRun: boolean; onRun: () => void; onResolve: (item: Escalation) => void }) {
  const open = rows.filter((item) => item.status === "Open").length;
  return <>
    <PageHeading eyebrow="DEADLINE INTELLIGENCE" title="Escalation queue" description="Persistent tracking of cases exceeding configured processing thresholds. Prompts supervisory review." action={canRun && <button className="primary-btn" onClick={onRun}>Run deadline check <Activity size={15} /></button>} />
    <div className="metric-grid three-metrics"><div className="metric-card static"><span className="metric-icon red"><AlertTriangle size={18} /></span><span className="metric-label">Open escalations</span><strong>{open}</strong><small>Awaiting recorded officer follow-up</small></div><div className="metric-card static"><span className="metric-icon blue"><Check size={18} /></span><span className="metric-label">Resolved</span><strong>{rows.length - open}</strong><small>Resolution reason retained</small></div><div className="metric-card static"><span className="metric-icon navy"><Activity size={18} /></span><span className="metric-label">In authorised scope</span><strong>{rows.length}</strong><small>Applications and obligations</small></div></div>
    <section className="panel"><div className="panel-heading"><div><h2>Escalated cases</h2><p>Repeated deadline checks do not create duplicate open escalation events.</p></div><span className="synthetic-label">RULE-TRIGGERED</span></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>RECORD</th><th>INSTITUTION</th><th>TYPE</th><th>TRIGGER REASON</th><th>CREATED</th><th>STATUS</th><th /></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td><b className="reference">{item.reference}</b><small>{item.entity_type.replaceAll("_", " ")}</small></td><td><b>{item.institution_name}</b><small>{item.region}</small></td><td>{item.entity_type === "application" ? "Application deadline" : "Compliance obligation"}</td><td className="audit-reason">{item.reason}</td><td>{date(item.created_at)}</td><td><Badge>{item.status}</Badge></td><td>{item.status === "Open" && <button className="mini-action" title="Record resolution" onClick={() => onResolve(item)}><Check size={15} /></button>}</td></tr>)}</tbody></table></div>
      {!rows.length && <div className="empty-state"><Check size={25} /><b>No escalations in scope</b><span>Run the deadline check to evaluate recorded due dates.</span></div>}
    </section>
  </>;
}

function InstitutionProfileView({ institutions, applications, compliance, documents, onSelect }: {
  institutions: Institution[]; applications: Application[]; compliance: Compliance[]; documents: DocumentRow[]; onSelect: (item: Application) => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const institution = institutions.find((item) => item.id === selectedId) ?? institutions[0];
  if (!institution) return <div className="empty-state"><Building2 size={25} /><b>No institution is visible</b><span>Institution details are limited to your authorised scope.</span></div>;
  const institutionApps = applications.filter((item) => item.institution_name === institution.name);
  const obligations = compliance.filter((item) => item.institution_name === institution.name);
  const institutionDocs = documents.filter((item) => item.institution_name === institution.name);
  return <>
    <PageHeading eyebrow="INSTITUTION RECORD" title="Institution profile" description="A consolidated view of linked applications, compliance conditions and document validity in your scope." action={<label className="profile-select"><span>INSTITUTION</span><select value={institution.id} onChange={(event) => setSelectedId(event.target.value)}>{institutions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>} />
    <section className="institution-hero panel"><div className="institution-symbol"><Building2 size={25} /></div><div className="institution-title"><span className="eyebrow">SYNTHETIC INSTITUTION RECORD</span><h2>{institution.name}</h2><p>{institution.code} <span>·</span> {institution.city}, {institution.region}</p></div><Badge>{institution.status}</Badge></section>
    <div className="metric-grid three-metrics"><div className="metric-card static"><span className="metric-icon blue"><ClipboardList size={18} /></span><span className="metric-label">Linked applications</span><strong>{institutionApps.length}</strong><small>{institutionApps.filter((item) => item.stage !== "Completed").length} currently in progress</small></div><div className="metric-card static"><span className="metric-icon amber"><BookOpenCheck size={18} /></span><span className="metric-label">Open obligations</span><strong>{obligations.filter((item) => !["Verified", "Closed"].includes(item.status)).length}</strong><small>Verification remains a human decision</small></div><div className="metric-card static"><span className="metric-icon navy"><FileText size={18} /></span><span className="metric-label">Registered documents</span><strong>{institutionDocs.length}</strong><small>{institutionDocs.filter((item) => item.days_to_expiry !== null && item.days_to_expiry < 0).length} past recorded expiry</small></div></div>
    <section className="panel"><div className="panel-heading"><div><h2>Application history</h2><p>Current and historical linked records</p></div></div><ApplicationTable rows={institutionApps} onSelect={onSelect} /></section>
    <div className="profile-grid"><section className="panel"><div className="panel-heading"><div><h2>Outstanding obligations</h2><p>Submission and verification status</p></div></div>{obligations.map((item) => <div className="profile-list-row" key={item.id}><div><b>{item.title}</b><small>Due {date(item.due_at)}</small></div><Badge>{item.status}</Badge></div>)}{!obligations.length && <div className="empty-inline">No obligations are recorded.</div>}</section>
      <section className="panel"><div className="panel-heading"><div><h2>Document register</h2><p>Validity and verification tracking</p></div></div>{institutionDocs.map((item) => <div className="profile-list-row" key={item.id}><div><b>{item.category}</b><small>Expires {date(item.expires_at)}</small></div><Badge>{item.status}</Badge></div>)}{!institutionDocs.length && <div className="empty-inline">No documents are registered.</div>}</section></div>
    <p className="profile-disclaimer"><ShieldCheck size={14} /> This profile summarises recorded demonstration data; it does not state an official regulatory finding.</p>
  </>;
}

function ReportView({ summary, onExport }: { summary: ReportSummary | null; onExport: () => void }) {
  if (!summary) return <div className="empty-state"><BarChart3 size={25} /><b>Report data unavailable</b><span>Check the API connection and your reporting permissions.</span></div>;
  const max = (values: { count: number }[]) => Math.max(1, ...values.map((item) => item.count));
  return <>
    <PageHeading eyebrow="OPERATIONAL INTELLIGENCE" title="Reports & analytics" description="Real-time pendency metrics calculated from persistent database records with CSV export." action={<button className="outline-action" onClick={onExport}><FileText size={15} /> Export authorised CSV</button>} />
    <div className="report-summary"><span><b>{summary.total_applications}</b> authorised application records</span><span>Generated {new Date(summary.generated_at).toLocaleString()}</span><span className="synthetic-label">SYNTHETIC DATA</span></div>
    <div className="report-grid">
      <section className="panel report-panel"><div className="panel-heading"><div><h2>Stage-wise workload</h2><p>Application count by current stage</p></div></div><div className="bar-list">{summary.stage_distribution.map((item, index) => <div className="bar-row" key={item.stage}><div><span>{item.stage}</span><b>{item.count}</b></div><i><span style={{ width: `${(item.count / max(summary.stage_distribution)) * 100}%`, background: ["#315ce8", "#ebaa3f", "#7e64d8", "#219877"][index % 4] }} /></i></div>)}</div></section>
      <section className="panel report-panel"><div className="panel-heading"><div><h2>Regional pendency</h2><p>Active applications grouped by region</p></div></div><div className="bar-list">{summary.region_pendency.map((item) => <div className="bar-row" key={item.region}><div><span>{item.region}</span><b>{item.count}</b></div><i><span style={{ width: `${(item.count / max(summary.region_pendency)) * 100}%` }} /></i></div>)}</div>{!summary.region_pendency.length && <div className="empty-inline">No active applications in scope.</div>}</section>
      <section className="panel report-panel"><div className="panel-heading"><div><h2>Application ageing</h2><p>Age since recorded submission date</p></div></div><div className="bar-list">{summary.ageing.map((item) => <div className="bar-row" key={item.band}><div><span>{item.band}</span><b>{item.count}</b></div><i><span style={{ width: `${(item.count / max(summary.ageing)) * 100}%`, background: "#6d82b5" }} /></i></div>)}</div></section>
      <section className="panel report-panel"><div className="panel-heading"><div><h2>Overdue by assigned unit</h2><p>Open applications past recorded due date</p></div></div><div className="bar-list">{summary.overdue_by_unit.map((item) => <div className="bar-row" key={item.unit}><div><span>{item.unit}</span><b>{item.count}</b></div><i><span style={{ width: `${(item.count / max(summary.overdue_by_unit)) * 100}%`, background: "#c44949" }} /></i></div>)}</div>{!summary.overdue_by_unit.length && <div className="empty-inline">No overdue cases in scope.</div>}</section>
    </div>
    <p className="profile-disclaimer"><Clock3 size={14} /> Ageing is measured from submission timestamp. Synthetic demonstration records.</p>
  </>;
}
