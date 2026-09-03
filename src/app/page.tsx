"use client";

import { useEffect, useRef, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { DataTable, EmptyState, type ColumnDef } from "@/components/DataTable";

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

// Phases 2 and 3 added Cause, Why and Self-healed, which pushed this table past
// 1,900px — well beyond the panel, so the columns that matter most sat off
// screen behind a horizontal scroll. Two changes bring it back:
//
//   - `actual_result` is dropped. On a pass it is the fixed string "Executed
//     successfully; all assertions passed."; on a failure it repeats
//     `error_message`. It never carried information the neighbouring columns
//     didn't already have.
//   - The remaining widths are tightened. Long prose cells are clamped by
//     DataTable and reveal in full on hover, so narrower is not lossier.
//
// Order follows the question a reader actually asks: what ran, did it pass,
// whose fault was it, was it repaired, then the supporting detail.
const EXECUTION_COLUMNS: ColumnDef[] = [
  { key: "executed_at", label: "Executed At", width: "150px" },
  { key: "case_id", label: "Test Case", width: "105px" },
  { key: "result", label: "Result", width: "70px" },
  { key: "classification", label: "Cause", width: "110px" },
  { key: "classification_reason", label: "Why", width: "200px" },
  { key: "self_healed", label: "Self-healed", width: "170px" },
  { key: "error_message", label: "Error", width: "200px" },
  { key: "evidence", label: "Evidence", width: "165px" },
  { key: "run_label", label: "Run", width: "120px" },
  { key: "duration_ms", label: "Duration", width: "85px" },
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

type DocumentFormat = {
  id: string;
  docType: "test_plan" | "test_strategy";
  name: string;
  description: string;
  basedOn: string;
  bestFor: string;
  length: string;
  sectionCount: number;
  sections: string[];
  accent: string;
};

const QUICK_ACTIONS: {
  label: string;
  icon: string;
  hint: string;
  message?: string;
  /** Opens the format picker instead of sending immediately. */
  chooseFormatFor?: "test_plan" | "test_strategy";
}[] = [
  {
    label: "Test Plan",
    icon: "📋",
    hint: "Choose a format — IEEE 829, ISO 29119, Agile or Enterprise UAT",
    chooseFormatFor: "test_plan",
  },
  {
    label: "Test Strategy",
    icon: "🧭",
    hint: "Choose a format — Standard, Risk-Based or Agile QA",
    chooseFormatFor: "test_strategy",
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
  const newProjectInputRef = useRef<HTMLInputElement>(null);
  // Mirrors selectedProjectId for code that needs the *current* value inside
  // a callback whose own closure captured an older one — see sendMessage.
  const selectedProjectIdRef = useRef<string | null>(null);
  const [formatPickerFor, setFormatPickerFor] = useState<"test_plan" | "test_strategy" | null>(null);
  const [documentFormats, setDocumentFormats] = useState<DocumentFormat[]>([]);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        // Deliberately does NOT auto-select the most recent project: the app
        // opens on the New Chat screen so starting fresh work is the default
        // action, rather than dropping you into whatever you last touched.
        setProjects(data.projects ?? []);
      })
      .catch(() => setError("Could not reach the server to load projects."));
  }, []);

  // The format catalogue is static, so it's fetched once rather than each
  // time the picker opens.
  useEffect(() => {
    fetch("/api/document-formats")
      .then((r) => r.json())
      .then((d) => setDocumentFormats(d.formats ?? []))
      .catch(() => {
        /* picker falls back to a plain request without a named format */
      });
  }, []);

  function chooseFormat(format: DocumentFormat) {
    setFormatPickerFor(null);
    const label = format.docType === "test_plan" ? "Test Plan" : "Test Strategy";
    sendMessage(
      `Generate a complete ${label} for this project using the "${format.name}" format (templateId: "${format.id}"). ` +
        `Follow that format's required sections exactly, in order, and write real content under every one. ` +
        `Use markdown tables for anything matrix-shaped — risk matrices, RACI, severity/priority definitions, environments, schedules — so the Word document renders them as proper tables. ` +
        `Save it with save_document using docType "${format.docType}" and templateId "${format.id}".`
    );
  }

  // Returns to the New Chat screen. Also reachable by clicking the logo.
  function startNewChat() {
    setSelectedProjectId(null);
    clearProjectState();
    setActiveTab("chat");
    setChatInput("");
    setError(null);
    setNewProjectName("");
    // Focused on the next frame, after the landing screen has rendered.
    requestAnimationFrame(() => newProjectInputRef.current?.focus());
  }

  // Clears everything scoped to a project. Called wherever the selection is
  // dropped, rather than from an effect watching for null: an effect that
  // synchronously sets seven pieces of state fires a second render pass every
  // time, and the clearing genuinely belongs to the action that deselects.
  function clearProjectState() {
    setMessages([]);
    setDocuments([]);
    setRequirements([]);
    setTestScenarios([]);
    setTestCases([]);
    setExecutions([]);
    setBugReports([]);
    setBenchmarkRows([]);
    setGeneratedDocuments([]);
  }

  // `isStale` lets a caller abandon a response that arrived after the user
  // moved on — without it, a slow load for the previous project overwrites the
  // current one's data.
  async function refreshArtifacts(projectId: string, isStale: () => boolean = () => false) {
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
    if (isStale()) return;
    setRequirements(reqData.requirements ?? []);
    setTestScenarios(scnData.testScenarios ?? []);
    setTestCases(tcData.testCases ?? []);
    setExecutions(execData.executions ?? []);
    setBugReports(bugData.bugReports ?? []);
    setBenchmarkRows(benchData.benchmarkRows ?? []);
    setGeneratedDocuments(docData.documents ?? []);
  }

  // Kept in sync on every render this state changes. sendMessage is an async
  // function that keeps running after the user may have switched projects;
  // reading this ref when its fetch resolves is how it tells "still the
  // project I was sent for" from "the user has since moved on."
  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) return;

    // Guarded against the switch-projects race: clicking A then B fires two
    // overlapping loads, and if A's response lands second it overwrites B's
    // data with the wrong project's. The flag makes every late response a
    // no-op, and doubles as the reason none of these setState calls can run
    // synchronously during the effect.
    let cancelled = false;
    const projectId = selectedProjectId;

    void (async () => {
      try {
        const [chatRes, docsRes] = await Promise.all([
          fetch(`/api/chat?projectId=${projectId}`),
          fetch(`/api/documents?projectId=${projectId}`),
        ]);
        const [chatData, docsData] = await Promise.all([chatRes.json(), docsRes.json()]);
        if (cancelled) return;
        setMessages(chatData.messages ?? []);
        setChatDisabled(!!chatData.chatDisabled);
        setDocuments(docsData.documents ?? []);
      } catch {
        if (!cancelled) setError("Could not reach the server to load this project.");
      }
    })();

    void (async () => {
      try {
        await refreshArtifacts(projectId, () => cancelled);
      } catch {
        if (!cancelled) {
          setError("Could not reach the server to load requirements/test cases/bugs/benchmark rows.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
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
    // Captured once, up front: a chat turn can take a couple of minutes (it's
    // a real agent run), long enough that the user may switch to a different
    // project before this resolves. Every setState below that would touch
    // project-scoped data is checked against the *current* selection via the
    // ref — a stale response must not overwrite whatever the user is looking
    // at now. `sending` itself is deliberately NOT guarded: it belongs to the
    // Send button of whichever project is open when the request settles, and
    // never resetting it would leave that button permanently disabled.
    const projectId = selectedProjectId;
    const isCurrentProject = () => selectedProjectIdRef.current === projectId;
    setChatInput("");
    setError(null);
    setWelcomeDismissed((w) => ({ ...w, [projectId]: true }));
    setMessages((m) => [...m, { role: "user", content: message, created_at: new Date().toISOString() }]);
    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, message }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (isCurrentProject()) setError(data.error ?? "Something went wrong.");
        return;
      }
      if (isCurrentProject()) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: data.reply,
            created_at: new Date().toISOString(),
            documents: data.documents ?? [],
          },
        ]);
        refreshArtifacts(projectId).catch(() => {});
      }
    } catch {
      if (isCurrentProject()) setError("Could not reach the server to send the message.");
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
        const next = remaining[0]?.id ?? null;
        setSelectedProjectId(next);
        // Deleting the open project leaves its rows on screen until the next
        // load resolves — or forever, if nothing is selected afterwards.
        clearProjectState();
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
        {/* The logo is the way home: clicking it always returns to the New
            Chat screen, which is the behaviour people already expect from a
            product wordmark. */}
        <button
          onClick={startNewChat}
          title="New chat"
          // Without this the accessible name is the concatenation of every
          // child string — "QAQA AssistantAnalyze · design · execute · report"
          // — which is what a screen reader announces for the control.
          aria-label="QA Assistant — start a new chat"
          className="app-nav-item"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "4px 6px",
            margin: "-4px -6px",
            border: "none",
            background: "transparent",
            textAlign: "left",
            cursor: "pointer",
            color: "inherit",
            font: "inherit",
          }}
        >
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
              QA Assistant
            </h1>
            <p style={{ fontSize: 11.5, color: "var(--app-text-dim)", marginTop: 2 }}>
              Analyze · design · execute · report
            </p>
          </div>
        </button>

        <button
          onClick={startNewChat}
          className="app-btn app-btn-primary"
          style={{ width: "100%", padding: "9px 14px", fontSize: 13.5 }}
        >
          <span style={{ fontSize: 15, lineHeight: 1 }} aria-hidden>
            +
          </span>
          New chat
        </button>

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
            // Just the action, not the identity: this is a personal local
            // tool, not a shared workspace where knowing *which* signed-in
            // user you are matters — the email added width pressure against
            // "Sign out" for no benefit anyone asked for.
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="app-btn app-btn-ghost"
              style={{ width: "100%", padding: "4px 8px", fontSize: 12.5 }}
            >
              Sign out
            </button>
          ) : (
            // Secondary: "New chat" above is the primary action, and two
            // solid buttons stacked would compete rather than guide.
            <Link href="/login" className="app-btn" style={{ width: "100%" }}>
              Sign in
            </Link>
          )}
        </div>

        <div>
          <div style={SIDEBAR_LABEL}>Projects</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {projects.length === 0 && (
              <span style={{ fontSize: 13, color: "var(--app-text-dim)" }}>
                {/* "below" was only true while the sidebar's own create input
                    was visible; on the New Chat screen it now points at the
                    main panel instead of at nothing. */}
                {selectedProjectId ? "No projects yet — create one below." : "No projects yet."}
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
          {/* Hidden on the New Chat screen, which already offers a larger,
              auto-focused version of exactly this control in the main panel.
              Showing both put two competing affordances for one action on
              screen at once, and left it ambiguous which one "Create" belonged
              to. Kept while a project is open, where it's the only way to
              start another without navigating away. */}
          {selectedProjectId && (
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
          )}
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
            <div style={{ fontSize: 22, fontWeight: 680, color: "var(--app-text)", letterSpacing: "-0.02em" }}>
              Start a new QA workspace
            </div>
            <div style={{ fontSize: 13.5, maxWidth: 400, lineHeight: 1.55 }}>
              Name it, upload your requirements, and the agent will analyze them, design tests,
              run them, and report on what it found.
            </div>

            <div style={{ display: "flex", gap: 8, width: "100%", maxWidth: 420, marginTop: 4 }}>
              <input
                ref={newProjectInputRef}
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
                placeholder="e.g. SmartLeave — Release 2.4"
                className="app-input"
                style={{ flex: 1, minWidth: 0, padding: "11px 13px", fontSize: 14 }}
              />
              <button
                onClick={handleCreateProject}
                disabled={!newProjectName.trim()}
                className="app-btn app-btn-primary"
                style={{ padding: "0 18px", fontSize: 14 }}
              >
                Create
              </button>
            </div>

            {projects.length > 0 && (
              <div style={{ width: "100%", maxWidth: 420, marginTop: 10 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.07em",
                    textTransform: "uppercase",
                    color: "var(--app-text-dim)",
                    marginBottom: 8,
                    textAlign: "left",
                  }}
                >
                  Or continue
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {projects.slice(0, 4).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setSelectedProjectId(p.id);
                        setActiveTab("chat");
                      }}
                      className="app-card app-card-interactive"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 13px",
                        textAlign: "left",
                        color: "var(--app-text)",
                        font: "inherit",
                        fontSize: 13.5,
                      }}
                    >
                      <span style={{ opacity: 0.6 }} aria-hidden>
                        ▤
                      </span>
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {p.name}
                      </span>
                      <span style={{ color: "var(--app-text-dim)" }} aria-hidden>
                        →
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
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
                  <DataTable
                    columns={REQUIREMENT_COLUMNS}
                    rows={requirements}
                    emptyLabel="No requirements saved yet."
                    emptyIcon="📝"
                    onGoToChat={() => setActiveTab("chat")}
                  />
                )}
                {activeTab === "test_scenarios" && (
                  <DataTable
                    columns={TEST_SCENARIO_COLUMNS}
                    rows={testScenarios}
                    emptyLabel="No test scenarios saved yet."
                    emptyIcon="🔀"
                    onGoToChat={() => setActiveTab("chat")}
                  />
                )}
                {activeTab === "test_cases" && (
                  <DataTable
                    columns={TEST_CASE_COLUMNS}
                    rows={testCases}
                    emptyLabel="No test cases saved yet."
                    emptyIcon="🧪"
                    onGoToChat={() => setActiveTab("chat")}
                  />
                )}
                {activeTab === "executions" && (
                  <DataTable
                    columns={EXECUTION_COLUMNS}
                    rows={executions}
                    emptyLabel="No tests have been executed yet."
                    emptyIcon="▶️"
                    onGoToChat={() => setActiveTab("chat")}
                  />
                )}
                {activeTab === "bug_reports" && (
                  <DataTable
                    columns={BUG_COLUMNS}
                    rows={bugReports}
                    emptyLabel="No bugs logged yet."
                    emptyIcon="🐞"
                    onGoToChat={() => setActiveTab("chat")}
                  />
                )}
                {activeTab === "benchmark" && (
                  <DataTable
                    columns={BENCHMARK_COLUMNS}
                    rows={benchmarkRows}
                    emptyLabel="No benchmark rows saved yet."
                    emptyIcon="🎯"
                    onGoToChat={() => setActiveTab("chat")}
                  />
                )}
                {activeTab === "generated_documents" && (
                  <GeneratedDocumentsList
                    documents={generatedDocuments}
                    projectId={selectedProjectId!}
                    onPreview={openGeneratedDocPreview}
                    onGoToChat={() => setActiveTab("chat")}
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
                            onClick={() =>
                              action.chooseFormatFor
                                ? setFormatPickerFor(action.chooseFormatFor)
                                : sendMessage(action.message!)
                            }
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
                      {sending && <WorkingIndicator />}
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

      {formatPickerFor && (
        <FormatPicker
          docType={formatPickerFor}
          formats={documentFormats}
          onChoose={chooseFormat}
          onClose={() => setFormatPickerFor(null)}
        />
      )}

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

// Format chooser. Different formats genuinely suit different delivery models —
// a regulated programme and a two-week sprint do not sign off the same
// document — so this shows what each is based on and what it suits, and lets
// the section list be inspected before committing.
function FormatPicker({
  docType,
  formats,
  onChoose,
  onClose,
}: {
  docType: "test_plan" | "test_strategy";
  formats: DocumentFormat[];
  onChoose: (f: DocumentFormat) => void;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const options = formats.filter((f) => f.docType === docType);
  const label = docType === "test_plan" ? "Test Plan" : "Test Strategy";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,10,15,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="app-card"
        style={{
          width: "100%",
          maxWidth: 720,
          maxHeight: "85vh",
          overflowY: "auto",
          padding: 22,
          boxShadow: "var(--app-shadow-lg)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 680, letterSpacing: "-0.01em" }}>
              Choose a {label} format
            </div>
            <div style={{ fontSize: 13, color: "var(--app-text-dim)", marginTop: 4 }}>
              The document is built to the format you pick — sections, tables and styling.
            </div>
          </div>
          <button onClick={onClose} className="app-btn app-btn-ghost" aria-label="Close">
            ✕
          </button>
        </div>

        <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
          {options.length === 0 && (
            <div style={{ fontSize: 13, color: "var(--app-text-dim)" }}>
              Couldn&apos;t load formats. Close this and just ask in chat instead.
            </div>
          )}
          {options.map((f) => (
            <div key={f.id} className="app-card" style={{ padding: 0, overflow: "hidden" }}>
              <button
                onClick={() => onChoose(f)}
                style={{
                  display: "flex",
                  width: "100%",
                  gap: 12,
                  padding: "14px 15px",
                  textAlign: "left",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  color: "var(--app-text)",
                  font: "inherit",
                }}
              >
                {/* Accent stripe previews the colour the document will use. */}
                <span
                  style={{
                    width: 4,
                    alignSelf: "stretch",
                    borderRadius: 2,
                    background: f.accent,
                    flexShrink: 0,
                  }}
                  aria-hidden
                />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontSize: 14.5, fontWeight: 650 }}>{f.name}</span>
                  <span
                    style={{
                      display: "block",
                      fontSize: 12.5,
                      color: "var(--app-text-dim)",
                      marginTop: 3,
                      lineHeight: 1.5,
                    }}
                  >
                    {f.description}
                  </span>
                  <span style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    <span className="app-pill app-pill-info">{f.bestFor}</span>
                    <span className="app-pill">{f.sectionCount} sections</span>
                    <span className="app-pill">{f.length}</span>
                  </span>
                </span>
                <span style={{ color: "var(--app-text-dim)", alignSelf: "center" }} aria-hidden>
                  →
                </span>
              </button>

              <div
                style={{
                  borderTop: "1px solid var(--app-border)",
                  padding: "8px 15px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: 11.5, color: "var(--app-text-dim)" }}>
                  Based on {f.basedOn}
                </span>
                <button
                  onClick={() => setExpanded(expanded === f.id ? null : f.id)}
                  className="app-btn app-btn-ghost"
                  style={{ marginLeft: "auto", padding: "3px 8px", fontSize: 12 }}
                >
                  {expanded === f.id ? "Hide sections" : "View sections"}
                </button>
              </div>

              {expanded === f.id && (
                <ol
                  style={{
                    margin: 0,
                    padding: "10px 15px 14px 34px",
                    fontSize: 12.5,
                    color: "var(--app-text-dim)",
                    lineHeight: 1.7,
                    background: "var(--app-surface)",
                  }}
                >
                  {f.sections.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Feedback while a turn is in flight. The chat endpoint returns only when the
// whole turn is done, so there is no real percentage to show — this reports
// elapsed time (which is true) and sets expectations for the long operations,
// rather than a progress number that would be invented.
function WorkingIndicator() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  // Phrased as what typically happens by now, not as a claim about what the
  // agent is doing at this instant — the client genuinely cannot know that.
  const hint =
    seconds < 8
      ? "Reading your request and any documents"
      : seconds < 25
        ? "Analyzing and generating — this usually takes a few moments"
        : seconds < 60
          ? "Still working. Long documents and test suites take longer"
          : "Long-running work. Test runs and full documents can take a few minutes";

  return (
    <div
      className="app-card"
      style={{
        maxWidth: 420,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 9,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <span className="app-dots" style={{ color: "var(--app-accent)" }} aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span style={{ fontWeight: 550 }}>Working…</span>
        <span
          style={{ marginLeft: "auto", color: "var(--app-text-dim)", fontVariantNumeric: "tabular-nums" }}
        >
          {seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`}
        </span>
      </div>
      <div className="app-progress" role="progressbar" aria-label="Working" />
      <div style={{ fontSize: 12, color: "var(--app-text-dim)" }}>{hint}</div>
    </div>
  );
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
        padding: "9px 20px",
        background: "var(--app-notice-bg)",
        borderBottom: "1px solid var(--app-notice-border)",
        color: "var(--app-notice-text)",
        fontSize: 13,
        fontWeight: 500,
        textAlign: "center",
      }}
    >
      <span>
        You&rsquo;re using QA Assistant as a guest — this project and everything in it will be{" "}
        <strong>permanently deleted in {formatCountdown(msRemaining)}</strong>.
      </span>
      <Link
        href="/signup"
        className="app-nav-item"
        style={{
          color: "var(--app-notice-text)",
          background: "var(--app-notice-action-bg)",
          border: "1px solid var(--app-notice-border)",
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
  onGoToChat,
}: {
  documents: GeneratedDocument[];
  projectId: string;
  onPreview: (doc: GeneratedDocument) => void;
  onGoToChat?: () => void;
}) {
  if (documents.length === 0) {
    return (
      <EmptyState
        icon="📄"
        title="No documents generated yet."
        hint="Ask for a Test Plan, Test Strategy, or a report and it will show up here as a real, downloadable Word document."
        onGoToChat={onGoToChat}
      />
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

// Chat replies are written in real markdown — headers, bold, tables, code —
// per the system prompt's own formatting rules, but the bubble used to dump
// `message.content` as a raw string. GFM tables in particular came through
// as literal "| Bug | Verdict |" pipe rows: readable to no one. Styled to
// track the bubble's own color variables (assistant vs. user) rather than
// fixed colors, since the same content can render on either background in
// either theme.
function markdownComponents(linkColor: string): Components {
  const mutedBorder = "color-mix(in srgb, currentColor 20%, transparent)";
  const softFill = "color-mix(in srgb, currentColor 8%, transparent)";
  return {
    p: ({ children }) => <p style={{ margin: "0 0 8px 0" }}>{children}</p>,
    strong: ({ children }) => <strong style={{ fontWeight: 650 }}>{children}</strong>,
    a: ({ children, href }) => (
      <a href={href} style={{ color: linkColor, textDecoration: "underline" }}>
        {children}
      </a>
    ),
    ul: ({ children }) => (
      <ul style={{ margin: "0 0 8px 0", paddingLeft: 20 }}>{children}</ul>
    ),
    ol: ({ children }) => (
      <ol style={{ margin: "0 0 8px 0", paddingLeft: 20 }}>{children}</ol>
    ),
    li: ({ children }) => <li style={{ marginBottom: 2 }}>{children}</li>,
    h1: ({ children }) => (
      <h1 style={{ fontSize: 16, fontWeight: 650, margin: "10px 0 6px 0" }}>{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 style={{ fontSize: 15, fontWeight: 650, margin: "10px 0 6px 0" }}>{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 style={{ fontSize: 14.5, fontWeight: 650, margin: "8px 0 4px 0" }}>{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 style={{ fontSize: 14, fontWeight: 650, margin: "8px 0 4px 0" }}>{children}</h4>
    ),
    hr: () => <hr style={{ border: "none", borderTop: `1px solid ${mutedBorder}`, margin: "10px 0" }} />,
    blockquote: ({ children }) => (
      <blockquote
        style={{
          margin: "6px 0",
          paddingLeft: 10,
          borderLeft: `3px solid ${mutedBorder}`,
          opacity: 0.85,
        }}
      >
        {children}
      </blockquote>
    ),
    code: ({ children, className }) => {
      // A fenced block's <code> carries a "language-xxx" className from
      // remark and is already wrapped in <pre> by the default renderer;
      // only inline `code` spans need the pill styling here.
      if (className) {
        return <code className={className}>{children}</code>;
      }
      return (
        <code
          style={{
            background: softFill,
            borderRadius: 4,
            padding: "1px 5px",
            fontSize: 12.5,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
          }}
        >
          {children}
        </code>
      );
    },
    pre: ({ children }) => (
      <pre
        style={{
          background: softFill,
          border: `1px solid ${mutedBorder}`,
          borderRadius: 8,
          padding: "10px 12px",
          overflowX: "auto",
          fontSize: 12.5,
          lineHeight: 1.5,
          margin: "6px 0",
        }}
      >
        {children}
      </pre>
    ),
    table: ({ children }) => (
      <div style={{ overflowX: "auto", margin: "6px 0" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: "100%" }}>
          {children}
        </table>
      </div>
    ),
    th: ({ children }) => (
      <th
        style={{
          border: `1px solid ${mutedBorder}`,
          padding: "6px 10px",
          textAlign: "left",
          fontWeight: 650,
          background: softFill,
          whiteSpace: "nowrap",
        }}
      >
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td style={{ border: `1px solid ${mutedBorder}`, padding: "6px 10px", verticalAlign: "top" }}>
        {children}
      </td>
    ),
  };
}

function MarkdownContent({ content, isUser }: { content: string; isUser: boolean }) {
  const linkColor = isUser ? "var(--app-bubble-user-text)" : "var(--app-accent)";
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents(linkColor)}>
      {content}
    </ReactMarkdown>
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
          fontSize: 14,
          lineHeight: 1.55,
          background: isUser ? "var(--app-bubble-user)" : "var(--app-bubble-assistant)",
          color: isUser ? "var(--app-bubble-user-text)" : "var(--app-bubble-assistant-text)",
          boxShadow: "var(--app-shadow-sm)",
        }}
      >
        <MarkdownContent content={message.content} isUser={isUser} />
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
