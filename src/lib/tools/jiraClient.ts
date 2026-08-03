import { config as appConfig } from "../config";

type JiraConfig = {
  baseUrl: string;
  email: string;
  apiToken: string;
};

function getConfig(): JiraConfig | null {
  return appConfig.jira;
}

export function isJiraConfigured(): boolean {
  return getConfig() !== null;
}

function authHeader(config: JiraConfig): string {
  return "Basic " + Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
}

async function jiraFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const config = getConfig();
  if (!config) {
    throw new Error(
      "Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN in .env.local to enable it."
    );
  }

  const res = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(config),
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const messages =
      (body?.errorMessages as string[] | undefined)?.join("; ") ||
      (body?.errors ? JSON.stringify(body.errors) : null) ||
      res.statusText;
    throw new Error(`Jira API error (${res.status}): ${messages}`);
  }

  return body;
}

// --- Atlassian Document Format helpers -------------------------------------

function toAdf(plainText: string) {
  return {
    type: "doc",
    version: 1,
    content: plainText.split("\n\n").map((para) => ({
      type: "paragraph",
      content: para ? [{ type: "text", text: para }] : [],
    })),
  };
}

function adfToPlainText(adf: unknown): string {
  if (!adf || typeof adf !== "object") return "";
  const node = adf as { type?: string; text?: string; content?: unknown[] };
  if (node.type === "text" && typeof node.text === "string") return node.text;
  if (Array.isArray(node.content)) {
    return node.content.map(adfToPlainText).join(node.type === "paragraph" ? "\n" : "");
  }
  return "";
}

// --- Public API --------------------------------------------------------------

export type JiraIssueSummary = {
  key: string;
  summary: string;
  status: string;
  issueType: string;
  priority: string | null;
  description: string;
};

type JiraIssueRecord = {
  key?: string;
  fields?: {
    summary?: string;
    status?: { name?: string };
    issuetype?: { name?: string };
    priority?: { name?: string } | null;
    description?: unknown;
  };
};

function summarizeIssue(raw: unknown): JiraIssueSummary {
  const issue = raw as JiraIssueRecord;
  return {
    key: issue.key ?? "",
    summary: issue.fields?.summary ?? "",
    status: issue.fields?.status?.name ?? "Unknown",
    issueType: issue.fields?.issuetype?.name ?? "Unknown",
    priority: issue.fields?.priority?.name ?? null,
    description: adfToPlainText(issue.fields?.description).trim(),
  };
}

export async function searchIssues(jql: string, maxResults = 25): Promise<JiraIssueSummary[]> {
  const body = await jiraFetch("/rest/api/3/search/jql", {
    method: "POST",
    body: JSON.stringify({
      jql,
      maxResults,
      fields: ["summary", "status", "issuetype", "priority", "description"],
    }),
  });
  const issues = (body as { issues?: unknown[] })?.issues ?? [];
  return issues.map(summarizeIssue);
}

export async function getIssue(key: string): Promise<JiraIssueSummary> {
  const body = await jiraFetch(
    `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status,issuetype,priority,description`
  );
  return summarizeIssue(body);
}

export async function createIssue(params: {
  projectKey: string;
  issueType: string;
  summary: string;
  description?: string;
}): Promise<{ key: string }> {
  const body = await jiraFetch("/rest/api/3/issue", {
    method: "POST",
    body: JSON.stringify({
      fields: {
        project: { key: params.projectKey },
        issuetype: { name: params.issueType },
        summary: params.summary,
        ...(params.description ? { description: toAdf(params.description) } : {}),
      },
    }),
  });
  return { key: (body as { key: string }).key };
}

export async function getTransitions(
  key: string
): Promise<{ id: string; name: string }[]> {
  const body = await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`);
  return (
    (body as { transitions?: { id: string; name: string }[] })?.transitions ?? []
  ).map((t) => ({ id: t.id, name: t.name }));
}

export async function transitionIssue(key: string, statusName: string): Promise<void> {
  const transitions = await getTransitions(key);
  const match = transitions.find((t) => t.name.toLowerCase() === statusName.toLowerCase());
  if (!match) {
    const available = transitions.map((t) => t.name).join(", ") || "(none available)";
    throw new Error(
      `No transition to "${statusName}" is available for ${key} from its current status. Available transitions: ${available}`
    );
  }
  await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
    method: "POST",
    body: JSON.stringify({ transition: { id: match.id } }),
  });
}

export async function addComment(key: string, body: string): Promise<void> {
  await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {
    method: "POST",
    body: JSON.stringify({ body: toAdf(body) }),
  });
}
