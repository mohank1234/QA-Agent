"use client";

import { useEffect, useRef, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { DataTable, type ColumnDef } from "@/components/DataTable";

type Project = {
  id: string;
  name: string;
  session_id: string | null;
  created_at: string;
  guest_id?: string | null;
  expires_at?: string | null;
};

type ChatDocument = {
  title: string;
  docType: string;
  previewUrl: string;
  downloadUrl: string;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  created_at: string;
  documents?: ChatDocument[];
};

type Document = {
  id: string;
  filename: string;
  uploaded_at: string;
};

type GeneratedDocument = {
  id: string;
  title: string;
  doc_type: string;
  filename: string;
  created_at: string;
};

type Tab =
  | "chat"
  | "requirements"
  | "test_scenarios"
  | "test_cases"
  | "executions"
  | "bug_reports"
  | "benchmark"
  | "generated_documents";

const TABS: { id: Tab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "requirements", label: "Requirements" },
  { id: "test_scenarios", label: "Scenarios" },
  { id: "test_cases", label: "Test Cases" },
  { id: "executions", label: "Executions" },
  { id: "bug_reports", label: "Bugs" },
  { id: "benchmark", label: "Benchmark" },
  { id: "generated_documents", label: "Documents" },
];

const REQUIREMENT_COLUMNS: ColumnDef[] = [
  { key: "req_id", label: "Requirement ID", width: "110px" },
  { key: "req_type", label: "Type", width: "150px" },
  { key: "description", label: "Description" },
  { key: "is_assumption", label: "Assumption", width: "90px" },
  { key: "source_document", label: "Source Document", width: "170px" },
];

const TEST_SCENARIO_COLUMNS: ColumnDef[] = [
  { key: "scenario_id", label: "Scenario ID", width: "110px" },
  { key: "scenario", label: "Scenario", width: "420px" },
  { key: "priority", label: "Priority", width: "80px" },
  { key: "source_requirement", label: "Requirement Mapping", width: "150px" },
];

const TEST_CASE_COLUMNS: ColumnDef[] = [
  { key: "case_id", label: "Test Case ID", width: "110px" },
  { key: "source_requirement", label: "Requirement Mapping", width: "150px" },
  { key: "scenario_ref", label: "Scenario", width: "110px" },
  { key: "module", label: "Module", width: "140px" },
  { key: "test_type", label: "Test Type", width: "110px" },
  { key: "priority", label: "Priority", width: "80px" },
  { key: "severity", label: "Severity", width: "80px" },
  { key: "preconditions", label: "Preconditions", width: "180px" },
  { key: "test_data", label: "Test Data", width: "180px" },
  { key: "steps", label: "Test Steps", width: "240px" },
  { key: "expected_result", label: "Expected Result", width: "220px" },
  { key: "actual_result", label: "Actual Result", width: "220px" },
  { key: "status", label: "Status", width: "90px" },
  { key: "last_executed_at", label: "Last Executed", width: "160px" },
  { key: "comments", label: "Comments", width: "180px" },
];

const EXECUTION_COLUMNS: ColumnDef[] = [
  { key: "executed_at", label: "Executed At", width: "170px" },
  { key: "case_id", label: "Test Case", width: "120px" },
  { key: "result", label: "Result", width: "80px" },
  { key: "run_label", label: "Run", width: "170px" },
  { key: "duration_ms", label: "Duration (ms)", width: "110px" },
  { key: "evidence", label: "Evidence", width: "230px" },
  { key: "actual_result", label: "Actual Result", width: "230px" },
  { key: "error_message", label: "Error", width: "260px" },
];

const BUG_COLUMNS: ColumnDef[] = [
  { key: "bug_id", label: "Bug ID", width: "90px" },
  { key: "title", label: "Title / Summary" },
  { key: "module", label: "Module", width: "130px" },
  { key: "environment", label: "Environment", width: "110px" },
  { key: "severity", label: "Severity", width: "80px" },
  { key: "priority", label: "Priority", width: "80px" },
  { key: "status", label: "Status", width: "100px" },
  { key: "preconditions", label: "Preconditions", width: "180px" },
  { key: "test_data", label: "Test Data", width: "180px" },
  { key: "description", label: "Description", width: "220px" },
  { key: "steps_to_reproduce", label: "Steps to Reproduce", width: "240px" },
  { key: "actual_result", label: "Actual Result", width: "220px" },
  { key: "expected_result", label: "Expected Result", width: "220px" },
  { key: "frequency", label: "Frequency", width: "110px" },
  { key: "root_cause_suggestion", label: "Root Cause Suggestion", width: "200px" },
  { key: "source_test_case", label: "Source Test Case", width: "130px" },
  { key: "attachments", label: "Attachments", width: "230px" },
  { key: "comments", label: "Comments", width: "180px" },
];

const BENCHMARK_COLUMNS: ColumnDef[] = [
  { key: "s_no", label: "S.No", width: "60px" },
  { key: "agent", label: "Agent", width: "100px" },
  { key: "question", label: "Question" },
  { key: "query_category", label: "Query Category", width: "150px" },
  { key: "scenario_type", label: "Scenario Type", width: "130px" },
  { key: "expected_answer", label: "Expected Answer" },
  { key: "answer_in_testing", label: "Answer in Testing" },
  { key: "score", label: "Score", width: "70px" },
  { key: "source_document", label: "Source Document", width: "150px" },
  { key: "notes", label: "Notes / Edge Flag" },
  { key: "pass_fail", label: "Pass / Fail", width: "90px" },
];

// Counts shown as badges on each tab. Kept as a lookup so the tab row stays a
// single loop instead of one conditional per tab inline.
type TabData = {
  requirements: unknown[];
  testScenarios: unknown[];
  testCases: unknown[];
  executions: unknown[];
  bugReports: unknown[];
  benchmarkRows: unknown[];
  generatedDocuments: unknown[];
};

const TAB_COUNTS: Partial<Record<Tab, (d: TabData) => number>> = {
  requirements: (d) => d.requirements.length,
  test_scenarios: (d) => d.testScenarios.length,
  test_cases: (d) => d.testCases.length,
  executions: (d) => d.executions.length,
  bug_reports: (d) => d.bugReports.length,
  benchmark: (d) => d.benchmarkRows.length,
  generated_documents: (d) => d.generatedDocuments.length,
};

const SIDEBAR_LABEL: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.07em",
  textTransform: "uppercase",
  color: "var(--app-text-dim)",
  marginBottom: 8,
};

const QUICK_ACTIONS: { label: string; icon: string; hint: string; message: string }[] = [
  {
    label: "Test Plan",
    icon: "📋",
    hint: "Scope, approach, risks, entry/exit criteria",
    message: "Generate a full Test Plan and Test Strategy for this project based on the uploaded documents.",
  },
  {
    label: "Test Cases",
    icon: "🧪",
    hint: "Scenarios, then detailed cases per requirement",
    message:
      "Analyze all uploaded documents, extract every requirement, and generate detailed test cases for each one.",
  },
  {
    label: "Benchmark Dataset",
    icon: "🎯",
    hint: "Q&A pairs grounded in your documents",
    message:
      "Build an AI/RAG benchmark dataset from the uploaded documents, covering positive, negative, and edge cases.",
  },
];

function downloadLinksFrom(text: string): string[] {
  const matches = [...text.matchAll(/\/api\/(?:exports|generated-documents)\/[^\s")]+/g)];
  return matches.map((m) => m[0]).filter((link) => !link.endsWith("/preview"));
}

export default function Home() {
  const { data: session, status: sessionStatus } = useSession();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatDisabled, setChatDisabled] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const [welcomeDismissed, setWelcomeDismissed] = useState<Record<string, boolean>>({});
  const [requirements, setRequirements] = useState<Record<string, unknown>[]>([]);
  const [testScenarios, setTestScenarios] = useState<Record<string, unknown>[]>([]);
  const [testCases, setTestCases] = useState<Record<string, unknown>[]>([]);
  const [executions, setExecutions] = useState<Record<string, unknown>[]>([]);
  const [bugReports, setBugReports] = useState<Record<string, unknown>[]>([]);
  const [benchmarkRows, setBenchmarkRows] = useState<Record<string, unknown>[]>([]);
  const [generatedDocuments, setGeneratedDocuments] = useState<GeneratedDocument[]>([]);
  const [previewFilename, setPreviewFilename] = useState<string | null>(null);
  const [previewDownloadHref, setPreviewDownloadHref] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        setProjects(data.projects ?? []);
        if (data.projects?.length) setSelectedProjectId(data.projects[0].id);
      })
      .catch(() => setError("Could not reach the server to load projects."));
  }, []);

  async function refreshArtifacts(projectId: string) {
    const [reqRes, scnRes, tcRes, execRes, bugRes, benchRes, docRes] = await Promise.all([
      fetch(`/api/requirements?projectId=${projectId}`),
      fetch(`/api/test-scenarios?projectId=${projectId}`),
      fetch(`/api/test-cases?projectId=${projectId}`),
      fetch(`/api/test-runs?projectId=${projectId}`),
      fetch(`/api/bug-reports?projectId=${projectId}`),
      fetch(`/api/benchmark-rows?projectId=${projectId}`),
      fetch(`/api/generated-documents?projectId=${projectId}`),
    ]);
    const [reqData, scnData, tcData, execData, bugData, benchData, docData] = await Promise.all([
      reqRes.json(),
      scnRes.json(),
      tcRes.json(),
      execRes.json(),
      bugRes.json(),
      benchRes.json(),
      docRes.json(),
    ]);
    setRequirements(reqData.requirements ?? []);
    setTestScenarios(scnData.testScenarios ?? []);
    setTestCases(tcData.testCases ?? []);
    setExecutions(execData.executions ?? []);
    setBugReports(bugData.bugReports ?? []);
    setBenchmarkRows(benchData.benchmarkRows ?? []);
    setGeneratedDocuments(docData.documents ?? []);
  }

  useEffect(() => {
    if (!selectedProjectId) return;
    fetch(`/api/chat?projectId=${selectedProjectId}`)
      .then((r) => r.json())
      .then((data) => {
        setMessages(data.messages ?? []);
        setChatDisabled(!!data.chatDisabled);
      })
      .catch(() => setError("Could not reach the server to load chat history."));
    fetch(`/api/documents?projectId=${selectedProjectId}`)
      .then((r) => r.json())
      .then((data) => setDocuments(data.documents ?? []))
      .catch(() => setError("Could not reach the server to load documents."));
    refreshArtifacts(selectedProjectId).catch(() =>
      setError("Could not reach the server to load requirements/test cases/bugs/benchmark rows.")
    );
  }, [selectedProjectId]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const showWelcome =
    !!selectedProjectId &&
    documents.length > 0 &&
    messages.length === 0 &&
    !welcomeDismissed[selectedProjectId] &&
    activeTab === "chat";

  // A brand-new project has no documents, so the quick-action welcome above
  // doesn't apply — without this the chat pane is a blank void with no hint
  // that uploading is the first step.
  const showEmptyChat =
    !!selectedProjectId && messages.length === 0 && !showWelcome && activeTab === "chat";

  useEffect(() => {
    if (!selectedProjectId) {
      setMessages([]);
      setDocuments([]);
      setRequirements([]);
      setTestCases([]);
      setBugReports([]);
      setBenchmarkRows([]);
      setGeneratedDocuments([]);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (activeTab === "chat") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, activeTab]);

  async function handleCreateProject() {
    const name = newProjectName.trim();
    if (!name) return;
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create project.");
        return;
      }
      if (data.project) {
        setProjects((p) => [data.project, ...p]);
        setSelectedProjectId(data.project.id);
        setActiveTab("chat");
        setNewProjectName("");
      }
    } catch {
      setError("Could not reach the server to create the project.");
    }
  }

  async function uploadOneFile(file: File): Promise<string | null> {
    if (!selectedProjectId) return "No project selected.";
    try {
      const form = new FormData();
      form.append("projectId", selectedProjectId);
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        return data.error ?? "Upload failed.";
      }
      setDocuments((docs) => [
        ...docs.filter((doc) => doc.filename !== data.filename),
        { id: data.id, filename: data.filename, uploaded_at: data.uploadedAt },
      ]);
      return null;
    } catch {
      return "Could not reach the server to upload the document.";
    }
  }

  async function handleUpload(files: FileList | File[]) {
    const fileList = Array.from(files);
    if (fileList.length === 0 || !selectedProjectId) return;
    setUploading(true);
    setError(null);
    const failures: string[] = [];
    for (const file of fileList) {
      const err = await uploadOneFile(file);
      if (err) failures.push(`${file.name}: ${err}`);
    }
    setUploading(false);
    if (failures.length > 0) {
      setError(
        failures.length === fileList.length
          ? `Upload failed: ${failures.join("; ")}`
          : `${fileList.length - failures.length} of ${fileList.length} uploaded. Failed: ${failures.join("; ")}`
      );
    }
  }

  async function sendMessage(message: string) {
    if (!message || !selectedProjectId || sending) return;
    setChatInput("");
    setError(null);
    setWelcomeDismissed((w) => ({ ...w, [selectedProjectId]: true }));
    setMessages((m) => [...m, { role: "user", content: message, created_at: new Date().toISOString() }]);
    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selectedProjectId, message }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: data.reply,
          created_at: new Date().toISOString(),
          documents: data.documents ?? [],
        },
      ]);
      refreshArtifacts(selectedProjectId).catch(() => {});
    } catch {
      setError("Could not reach the server to send the message.");
    } finally {
      setSending(false);
    }
  }

  async function handleDeleteProject(project: Project) {
    const confirmed = window.confirm(
      `Delete project "${project.name}"? This permanently removes its documents, requirements, test cases, bug reports, benchmark rows, and chat history. This cannot be undone.`
    );
    if (!confirmed) return;
    setError(null);
    try {
      const res = await fetch(`/api/projects?projectId=${project.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to delete project.");
        return;
      }
      const remaining = projects.filter((p) => p.id !== project.id);
      setProjects(remaining);
      if (selectedProjectId === project.id) {
        setSelectedProjectId(remaining[0]?.id ?? null);
      }
    } catch {
      setError("Could not reach the server to delete the project.");
    }
  }

  async function loadPreview(filename: string, previewUrl: string, downloadHref: string) {
    if (!selectedProjectId) return;
    setPreviewFilename(filename);
    setPreviewDownloadHref(downloadHref);
    setPreviewText(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const res = await fetch(previewUrl);
      const data = await res.json();
      if (!res.ok) {
        setPreviewError(data.error ?? "Could not preview this file.");
        return;
      }
      setPreviewText(data.text ?? "");
    } catch {
      setPreviewError("Could not reach the server to load the preview.");
    } finally {
      setPreviewLoading(false);
    }
  }

  function openPreview(filename: string) {
    if (!selectedProjectId) return;
    const encoded = encodeURIComponent(filename);
    loadPreview(
      filename,
      `/api/documents/${selectedProjectId}/${encoded}/preview`,
      `/api/documents/${selectedProjectId}/${encoded}`
    );
  }

  function openChatDocumentPreview(doc: ChatDocument) {
    loadPreview(doc.title, doc.previewUrl, doc.downloadUrl);
  }

  function openGeneratedDocPreview(doc: GeneratedDocument) {
    if (!selectedProjectId) return;
    const encoded = encodeURIComponent(doc.filename);
    loadPreview(
      doc.title,
      `/api/generated-documents/${selectedProjectId}/${encoded}/preview`,
      `/api/generated-documents/${selectedProjectId}/${encoded}`
    );
  }

  function closePreview() {
    setPreviewFilename(null);
    setPreviewDownloadHref(null);
    setPreviewText(null);
    setPreviewError(null);
    setPreviewLoading(false);
  }

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <aside
        style={{
          width: 260,
          borderRight: "1px solid var(--app-border)",
          background: "var(--app-panel)",
          display: "flex",
          flexDirection: "column",
          padding: 16,
          gap: 16,
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              flexShrink: 0,
              borderRadius: 9,
              display: "grid",
              placeItems: "center",
              background: "linear-gradient(140deg, var(--app-accent), #8b5cf6)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              boxShadow: "var(--app-shadow-sm)",
            }}
            aria-hidden
          >
            QA
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 15, fontWeight: 650, letterSpacing: "-0.01em" }}>
              QA Intelligence Agent
            </h1>
            <p style={{ fontSize: 11.5, color: "var(--app-text-dim)", marginTop: 2 }}>
              Analyze · design · execute · report
            </p>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 13,
            paddingBottom: 12,
            borderBottom: "1px solid var(--app-border)",
          }}
        >
          {sessionStatus === "loading" ? (
            <span style={{ color: "var(--app-text-dim)" }}>…</span>
          ) : session?.user ? (
            <>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {session.user.email ?? session.user.name}
              </span>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="app-btn app-btn-ghost"
                style={{ padding: "4px 8px", fontSize: 12.5, flexShrink: 0 }}
              >
                Sign out
              </button>
            </>
          ) : (
            <Link href="/login" className="app-btn app-btn-primary" style={{ width: "100%" }}>
              Sign in
            </Link>
          )}
        </div>

        <div>
          <div style={SIDEBAR_LABEL}>Projects</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {projects.length === 0 && (
              <span style={{ fontSize: 13, color: "var(--app-text-dim)" }}>
                No projects yet — create one below.
              </span>
            )}
            {projects.map((p) => {
              const active = p.id === selectedProjectId;
              return (
                <div
                  key={p.id}
                  className="app-nav-item"
                  data-active={active}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 2,
                    background: active ? "var(--app-accent)" : "transparent",
                  }}
                >
                  <button
                    onClick={() => {
                      setSelectedProjectId(p.id);
                      setActiveTab("chat");
                    }}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      textAlign: "left",
                      padding: "8px 10px",
                      borderRadius: "var(--app-radius)",
                      border: "none",
                      cursor: "pointer",
                      background: "transparent",
                      color: active ? "var(--app-accent-text)" : "var(--app-text)",
                      fontSize: 13.5,
                      fontWeight: active ? 600 : 450,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.name}
                  </button>
                  <button
                    onClick={() => handleDeleteProject(p)}
                    title={`Delete "${p.name}"`}
                    aria-label={`Delete project ${p.name}`}
                    className="app-btn app-btn-ghost app-btn-danger"
                    style={{
                      padding: "4px 7px",
                      marginRight: 4,
                      fontSize: 15,
                      lineHeight: 1,
                      color: active ? "var(--app-accent-text)" : "var(--app-text-dim)",
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <input
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
              placeholder="New project name"
              className="app-input"
              style={{ flex: 1, minWidth: 0, padding: "7px 10px", fontSize: 13 }}
            />
            <button
              onClick={handleCreateProject}
              className="app-btn app-btn-primary"
              title="Create project"
              aria-label="Create project"
              style={{ padding: "7px 12px", fontSize: 15, lineHeight: 1 }}
            >
              +
            </button>
          </div>
        </div>

        {selectedProjectId && (
          <div>
            <div style={SIDEBAR_LABEL}>Documents</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
              {documents.length === 0 && (
                <span style={{ color: "var(--app-text-dim)" }}>None yet</span>
              )}
              {documents.map((d) => (
                <div
                  key={d.id}
                  className="app-nav-item"
                  style={{ display: "flex", alignItems: "center", gap: 4, padding: "1px 2px" }}
                >
                  <button
                    onClick={() => openPreview(d.filename)}
                    title={`Uploaded ${d.uploaded_at} — click to preview`}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      textAlign: "left",
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      padding: "5px 6px",
                      border: "none",
                      background: "transparent",
                      color: "var(--app-text)",
                      cursor: "pointer",
                      fontSize: 13,
                    }}
                  >
                    <span style={{ opacity: 0.65, flexShrink: 0 }} aria-hidden>
                      ▤
                    </span>
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {d.filename}
                    </span>
                  </button>
                  <a
                    href={`/api/documents/${selectedProjectId}/${encodeURIComponent(d.filename)}`}
                    title={`Download ${d.filename}`}
                    className="app-btn app-btn-ghost"
                    style={{ padding: "3px 6px", fontSize: 12 }}
                  >
                    ⬇
                  </a>
                </div>
              ))}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              accept=".pdf,.docx,.xlsx,.xls,.csv,.pptx,.txt,.md"
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length > 0) handleUpload(files);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="app-btn"
              style={{ marginTop: 10, width: "100%", borderStyle: "dashed" }}
            >
              {uploading ? "Uploading…" : "⬆  Upload document(s)"}
            </button>
          </div>
        )}
      </aside>

      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {sessionStatus !== "loading" && !session?.user && selectedProject?.expires_at && (
          <GuestExpiryBanner expiresAt={selectedProject.expires_at} />
        )}
        {selectedProjectId && chatDisabled && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              flexWrap: "wrap",
              padding: "10px 20px",
              background: "#374151",
              color: "#fff",
              fontSize: 13,
              textAlign: "center",
            }}
          >
            <span>
              AI chat is disabled on this hosted site to keep it free to run — run the project
              locally to chat (it uses your own <code>claude login</code> session). Everything
              else here works normally.
            </span>
          </div>
        )}
        {!selectedProject ? (
          <div
            style={{
              margin: "auto",
              textAlign: "center",
              color: "var(--app-text-dim)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              padding: 24,
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                display: "grid",
                placeItems: "center",
                background: "var(--app-accent-soft)",
                color: "var(--app-accent)",
                fontSize: 24,
              }}
              aria-hidden
            >
              ◈
            </div>
            <div style={{ fontSize: 17, fontWeight: 650, color: "var(--app-text)" }}>
              Create or select a project to start
            </div>
            <div style={{ fontSize: 13.5, maxWidth: 380, lineHeight: 1.55 }}>
              Each project is its own workspace — documents, requirements, test cases, runs and
              reports stay together.
            </div>
            {sessionStatus !== "loading" && !session?.user && (
              <div
                className="app-card"
                style={{
                  fontSize: 12.5,
                  marginTop: 4,
                  maxWidth: 380,
                  padding: "10px 14px",
                  lineHeight: 1.5,
                }}
              >
                Not signed in — anything you create is permanently deleted 1 hour after creation.{" "}
                <Link href="/signup" className="app-link">
                  Sign up
                </Link>{" "}
                first to keep your work.
              </div>
            )}
          </div>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderBottom: "1px solid var(--app-border)",
              }}
            >
              <div
                style={{
                  padding: "12px 20px",
                  fontSize: 14.5,
                  fontWeight: 650,
                  letterSpacing: "-0.01em",
                  whiteSpace: "nowrap",
                }}
              >
                {selectedProject.name}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 2,
                  paddingRight: 12,
                  overflowX: "auto",
                  scrollbarWidth: "none",
                }}
              >
                {TABS.map((tab) => {
                  const active = activeTab === tab.id;
                  const count = TAB_COUNTS[tab.id]?.({
                    requirements,
                    testScenarios,
                    testCases,
                    executions,
                    bugReports,
                    benchmarkRows,
                    generatedDocuments,
                  });
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className="app-tab"
                      data-active={active}
                      aria-current={active ? "page" : undefined}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "11px 13px",
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        fontSize: 13,
                        fontWeight: active ? 650 : 450,
                        color: active ? "var(--app-accent)" : "var(--app-text-dim)",
                        borderBottom: `2px solid ${active ? "var(--app-accent)" : "transparent"}`,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {tab.label}
                      {count ? <span className="app-count">{count}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            {activeTab !== "chat" && (
              <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                {activeTab === "requirements" && (
                  <DataTable columns={REQUIREMENT_COLUMNS} rows={requirements} emptyLabel="No requirements saved yet." />
                )}
                {activeTab === "test_scenarios" && (
                  <DataTable
                    columns={TEST_SCENARIO_COLUMNS}
                    rows={testScenarios}
                    emptyLabel="No test scenarios saved yet."
                  />
                )}
                {activeTab === "test_cases" && (
                  <DataTable columns={TEST_CASE_COLUMNS} rows={testCases} emptyLabel="No test cases saved yet." />
                )}
                {activeTab === "executions" && (
                  <DataTable
                    columns={EXECUTION_COLUMNS}
                    rows={executions}
                    emptyLabel="No tests have been executed yet."
                  />
                )}
                {activeTab === "bug_reports" && (
                  <DataTable columns={BUG_COLUMNS} rows={bugReports} emptyLabel="No bugs logged yet." />
                )}
                {activeTab === "benchmark" && (
                  <DataTable columns={BENCHMARK_COLUMNS} rows={benchmarkRows} emptyLabel="No benchmark rows saved yet." />
                )}
                {activeTab === "generated_documents" && (
                  <GeneratedDocumentsList
                    documents={generatedDocuments}
                    projectId={selectedProjectId!}
                    onPreview={openGeneratedDocPreview}
                  />
                )}
              </div>
            )}

            {activeTab === "chat" && (
              <>
                <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
                  {showWelcome ? (
                    <div
                      style={{
                        margin: "auto",
                        maxWidth: 480,
                        textAlign: "center",
                        display: "flex",
                        flexDirection: "column",
                        gap: 16,
                        paddingTop: 60,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 18, fontWeight: 650, letterSpacing: "-0.01em" }}>
                          {documents.length} document{documents.length === 1 ? "" : "s"} ready
                        </div>
                        <div style={{ fontSize: 13.5, color: "var(--app-text-dim)", marginTop: 6 }}>
                          Pick a starting point, or just describe what you need.
                        </div>
                      </div>
                      <div style={{ display: "grid", gap: 10 }}>
                        {QUICK_ACTIONS.map((action) => (
                          <button
                            key={action.label}
                            onClick={() => sendMessage(action.message)}
                            className="app-card app-card-interactive"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 12,
                              padding: "13px 15px",
                              textAlign: "left",
                              color: "var(--app-text)",
                              font: "inherit",
                            }}
                          >
                            <span style={{ fontSize: 20, lineHeight: 1 }} aria-hidden>
                              {action.icon}
                            </span>
                            <span style={{ minWidth: 0 }}>
                              <span
                                style={{ display: "block", fontSize: 14, fontWeight: 600 }}
                              >
                                {action.label}
                              </span>
                              <span
                                style={{
                                  display: "block",
                                  fontSize: 12.5,
                                  color: "var(--app-text-dim)",
                                  marginTop: 2,
                                }}
                              >
                                {action.hint}
                              </span>
                            </span>
                            <span
                              style={{ marginLeft: "auto", color: "var(--app-text-dim)" }}
                              aria-hidden
                            >
                              →
                            </span>
                          </button>
                        ))}
                        <button
                          onClick={() => selectedProjectId && setWelcomeDismissed((w) => ({ ...w, [selectedProjectId]: true }))}
                          className="app-btn app-btn-ghost"
                          style={{ justifySelf: "center", marginTop: 2 }}
                        >
                          Something else…
                        </button>
                      </div>
                    </div>
                  ) : showEmptyChat ? (
                    <div
                      style={{
                        maxWidth: 460,
                        margin: "0 auto",
                        paddingTop: 72,
                        textAlign: "center",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 14,
                      }}
                    >
                      <div
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: 16,
                          display: "grid",
                          placeItems: "center",
                          background: "var(--app-accent-soft)",
                          color: "var(--app-accent)",
                          fontSize: 24,
                        }}
                        aria-hidden
                      >
                        ⬆
                      </div>
                      <div style={{ fontSize: 17, fontWeight: 650 }}>
                        Start by uploading a document
                      </div>
                      <div
                        style={{
                          fontSize: 13.5,
                          color: "var(--app-text-dim)",
                          lineHeight: 1.55,
                        }}
                      >
                        Drop in a BRD, PRD, spec or API doc and the agent will read it, extract
                        requirements, and design tests from it. You can also just type a question
                        below.
                      </div>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="app-btn app-btn-primary"
                        style={{ padding: "10px 18px", fontSize: 14 }}
                      >
                        {uploading ? "Uploading…" : "Upload document(s)"}
                      </button>
                      <div style={{ fontSize: 12, color: "var(--app-text-dim)" }}>
                        PDF · DOCX · XLSX · CSV · PPTX · TXT · MD
                      </div>
                    </div>
                  ) : (
                    <>
                      {messages.map((m, i) => (
                        <ChatBubble key={i} message={m} onPreviewDocument={openChatDocumentPreview} />
                      ))}
                      {sending && (
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            color: "var(--app-text-dim)",
                            fontSize: 13,
                            padding: "8px 12px",
                            borderRadius: 999,
                            background: "var(--app-bubble-assistant)",
                          }}
                        >
                          <span className="app-dots" aria-hidden>
                            <i />
                            <i />
                            <i />
                          </span>
                          Thinking…
                        </div>
                      )}
                    </>
                  )}
                  <div ref={messagesEndRef} />
                </div>
                {error && (
                  <div style={{ color: "var(--app-danger)", fontSize: 13, padding: "0 20px 8px" }}>
                    {error}
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-end",
                    gap: 8,
                    padding: 16,
                    borderTop: "1px solid var(--app-border)",
                    background: "var(--app-panel)",
                  }}
                >
                  <textarea
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage(chatInput.trim());
                      }
                    }}
                    disabled={chatDisabled}
                    placeholder={
                      chatDisabled
                        ? "Chat is disabled on this hosted site — run the project locally to chat."
                        : "Ask it to analyze a document, generate test cases, or run a test…"
                    }
                    rows={2}
                    className="app-input"
                    style={{
                      flex: 1,
                      resize: "none",
                      padding: "10px 12px",
                      fontSize: 14,
                      lineHeight: 1.45,
                      opacity: chatDisabled ? 0.6 : 1,
                    }}
                  />
                  <button
                    onClick={() => sendMessage(chatInput.trim())}
                    disabled={sending || !chatInput.trim() || chatDisabled}
                    className="app-btn app-btn-primary"
                    title="Send  (Enter)"
                    style={{ padding: "0 20px", height: 44, fontSize: 14 }}
                  >
                    {sending ? "Sending…" : "Send"}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </main>

      {previewFilename && previewDownloadHref && (
        <DocumentPreviewModal
          filename={previewFilename}
          text={previewText}
          loading={previewLoading}
          error={previewError}
          downloadHref={previewDownloadHref}
          onClose={closePreview}
        />
      )}
    </div>
  );
}

function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "any moment now";
  const totalSeconds = Math.floor(msRemaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function GuestExpiryBanner({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const msRemaining = new Date(expiresAt).getTime() - now;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "10px 20px",
        background: "var(--app-danger)",
        color: "#fff",
        fontSize: 13,
        fontWeight: 500,
        textAlign: "center",
      }}
    >
      <span>
        ⚠ You&rsquo;re using QA Agent as a guest — this project and everything in it will be{" "}
        <strong>permanently deleted in {formatCountdown(msRemaining)}</strong>.
      </span>
      <Link
        href="/signup"
        style={{
          color: "#fff",
          background: "rgba(255,255,255,0.2)",
          padding: "3px 10px",
          borderRadius: 6,
          textDecoration: "none",
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        Sign up to keep it
      </Link>
    </div>
  );
}

function GeneratedDocumentsList({
  documents,
  projectId,
  onPreview,
}: {
  documents: GeneratedDocument[];
  projectId: string;
  onPreview: (doc: GeneratedDocument) => void;
}) {
  if (documents.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--app-text-dim)" }}>
        No documents generated yet. Ask for a Test Plan, Test Strategy, or a report and it will
        show up here as a real, downloadable Word document.
      </div>
    );
  }

  const thStyle = {
    position: "sticky" as const,
    top: 0,
    background: "var(--app-panel)",
    borderBottom: "2px solid var(--app-border)",
    textAlign: "left" as const,
    padding: "8px 12px",
    whiteSpace: "nowrap" as const,
    color: "var(--app-text-dim)",
    fontWeight: 600,
  };
  const tdStyle = {
    padding: "8px 12px",
    verticalAlign: "top" as const,
  };

  return (
    <div style={{ overflow: "auto", height: "100%" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
        <thead>
          <tr>
            <th style={thStyle}>Title</th>
            <th style={{ ...thStyle, width: 200 }}>Type</th>
            <th style={{ ...thStyle, width: 180 }}>Created</th>
            <th style={{ ...thStyle, width: 160 }}></th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <tr key={doc.id} style={{ borderBottom: "1px solid var(--app-border)" }}>
              <td style={tdStyle}>{doc.title}</td>
              <td style={tdStyle}>{doc.doc_type.replace(/_/g, " ")}</td>
              <td style={tdStyle}>{new Date(doc.created_at).toLocaleString()}</td>
              <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                <button
                  onClick={() => onPreview(doc)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "var(--app-accent)",
                    cursor: "pointer",
                    fontSize: 13,
                    padding: 0,
                    textDecoration: "underline",
                  }}
                >
                  Preview
                </button>
                {" · "}
                <a
                  href={`/api/generated-documents/${projectId}/${encodeURIComponent(doc.filename)}`}
                  style={{ color: "var(--app-accent)", textDecoration: "underline", fontSize: 13 }}
                >
                  ⬇ Download
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DocumentPreviewModal({
  filename,
  text,
  loading,
  error,
  downloadHref,
  onClose,
}: {
  filename: string;
  text: string | null;
  loading: boolean;
  error: string | null;
  downloadHref: string;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--app-panel)",
          borderRadius: 10,
          border: "1px solid var(--app-border)",
          width: "100%",
          maxWidth: 800,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "12px 16px",
            borderBottom: "1px solid var(--app-border)",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {filename}
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexShrink: 0 }}>
            <a
              href={downloadHref}
              style={{ fontSize: 13, color: "var(--app-accent)", textDecoration: "underline" }}
            >
              ⬇ Download
            </a>
            <button
              onClick={onClose}
              style={{
                border: "none",
                background: "transparent",
                color: "var(--app-text-dim)",
                cursor: "pointer",
                fontSize: 18,
                lineHeight: 1,
                padding: 0,
              }}
            >
              ×
            </button>
          </div>
        </div>
        <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
          {loading && <div style={{ color: "var(--app-text-dim)", fontSize: 13 }}>Loading preview…</div>}
          {error && <div style={{ color: "var(--app-danger)", fontSize: 13 }}>{error}</div>}
          {!loading && !error && (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "inherit",
                fontSize: 13,
                lineHeight: 1.5,
                margin: 0,
                color: "var(--app-text)",
              }}
            >
              {text}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatBubble({
  message,
  onPreviewDocument,
}: {
  message: Message;
  onPreviewDocument: (doc: ChatDocument) => void;
}) {
  const isUser = message.role === "user";
  const links = message.role === "assistant" ? downloadLinksFrom(message.content) : [];
  const documents = message.documents ?? [];
  const linkColor = isUser ? "var(--app-bubble-user-text)" : "var(--app-accent)";

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        marginBottom: 12,
      }}
    >
      <div
        style={{
          // Capped in ch as well as %: on a wide monitor 70% is ~1100px, which
          // is far past the ~75-character line length prose stays readable at.
          maxWidth: "min(70%, 78ch)",
          padding: "11px 15px",
          // Asymmetric corner on the speaker's side — the usual visual cue for
          // who said what, so the two sides don't read as identical blocks.
          borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
          whiteSpace: "pre-wrap",
          fontSize: 14,
          lineHeight: 1.55,
          background: isUser ? "var(--app-bubble-user)" : "var(--app-bubble-assistant)",
          color: isUser ? "var(--app-bubble-user-text)" : "var(--app-bubble-assistant-text)",
          boxShadow: "var(--app-shadow-sm)",
        }}
      >
        {message.content}
        {links.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            {links.map((link) => (
              <a
                key={link}
                href={link}
                style={{ color: linkColor, textDecoration: "underline", fontSize: 13 }}
              >
                ⬇ Download {link.split("/").pop()}
              </a>
            ))}
          </div>
        )}
        {documents.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            {documents.map((doc, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13 }}>📄 {doc.title}</span>
                <button
                  onClick={() => onPreviewDocument(doc)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: linkColor,
                    textDecoration: "underline",
                    cursor: "pointer",
                    fontSize: 13,
                    padding: 0,
                  }}
                >
                  Preview
                </button>
                <a href={doc.downloadUrl} style={{ color: linkColor, textDecoration: "underline", fontSize: 13 }}>
                  ⬇ Download
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
