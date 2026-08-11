import { prisma } from "../prisma";
import { computeProjectStats } from "../db";

// Report figures assembled from real run history.
//
// The distinction this module exists to enforce: a test case that has been
// WRITTEN is not a test case that has been RUN. Reports used to be built from
// creation counts, which made "Test Execution Report" and "Release Readiness"
// describe how much was authored rather than how much passed. Every execution
// number below comes from TestRun/TestExecution rows.

export type ReportKind =
  | "test_execution"
  | "defect_summary"
  | "release_readiness"
  | "daily_status"
  | "regression";

/**
 * Percentage, or null when there is nothing to take a percentage OF.
 *
 * The null matters more than the number. If this returned 0 for an empty
 * denominator, a report would render "0% pass rate" for a project where no
 * test has ever run — indistinguishable from a project where everything ran
 * and failed. Null forces the caller to say "no data" instead.
 */
export function pct(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10;
}

export type ExecutionReportData = Awaited<ReturnType<typeof buildReportData>>;

export async function buildReportData(projectId: string, kind: ReportKind) {
  const stats = await computeProjectStats(projectId);

  const [runs, executedCases, notRunCases, bugs, blockedCases] = await Promise.all([
    prisma.testRun.findMany({
      where: { projectId },
      orderBy: { startedAt: "desc" },
      take: 10,
      include: { executions: { select: { passed: true, caseId: true } } },
    }),
    prisma.testCase.findMany({
      where: { projectId, status: { not: null } },
      select: {
        caseId: true,
        module: true,
        priority: true,
        severity: true,
        status: true,
        lastExecutedAt: true,
        actualResult: true,
      },
      orderBy: { caseId: "asc" },
    }),
    prisma.testCase.findMany({
      where: { projectId, status: null },
      select: { caseId: true, module: true, priority: true },
      orderBy: { caseId: "asc" },
    }),
    prisma.bugReport.findMany({
      where: { projectId },
      select: {
        bugId: true,
        title: true,
        module: true,
        severity: true,
        priority: true,
        status: true,
        environment: true,
        sourceTestCase: true,
        dateReported: true,
        attachmentsJson: true,
      },
      orderBy: { dateReported: "desc" },
    }),
    prisma.testCase.count({ where: { projectId, status: "Blocked" } }),
  ]);

  const hasExecutionData = stats.executionCount > 0;

  // Per-module execution breakdown, from executed cases only. A module with
  // nothing run shows as untested rather than silently absent.
  const moduleMap = new Map<string, { pass: number; fail: number; blocked: number; notRun: number }>();
  const bump = (module: string | null, key: "pass" | "fail" | "blocked" | "notRun") => {
    const name = module ?? "Unspecified";
    const entry = moduleMap.get(name) ?? { pass: 0, fail: 0, blocked: 0, notRun: 0 };
    entry[key] += 1;
    moduleMap.set(name, entry);
  };
  for (const c of executedCases) {
    bump(c.module, c.status === "Pass" ? "pass" : c.status === "Blocked" ? "blocked" : "fail");
  }
  for (const c of notRunCases) bump(c.module, "notRun");

  const byModule = [...moduleMap.entries()].map(([module, v]) => ({
    module,
    ...v,
    total: v.pass + v.fail + v.blocked + v.notRun,
    passRatePercent: pct(v.pass, v.pass + v.fail + v.blocked),
  }));

  const openBugs = bugs.filter(
    (b) => !["Done", "Closed", "Ready for UAT"].includes(b.status)
  );
  const criticalOpen = openBugs.filter((b) => b.severity === "Critical" || b.severity === "High");

  const runHistory = runs.map((r) => ({
    runId: r.id,
    label: r.label,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    total: r.executions.length,
    passed: r.executions.filter((e) => e.passed).length,
    failed: r.executions.filter((e) => !e.passed).length,
    passRatePercent: pct(r.executions.filter((e) => e.passed).length, r.executions.length),
  }));

  // Release readiness is expressed as explicit, checkable conditions rather
  // than a single invented score — each one names the real number behind it,
  // so a reader can disagree with a threshold without being misled about the
  // facts.
  const executionCoveragePercent = pct(stats.executedCaseCount, stats.testCaseCount);
  const currentPassRatePercent = pct(stats.testCasesByStatus.Pass, stats.executedCaseCount);

  const readinessChecks = [
    {
      check: "All test cases executed",
      met: stats.testCaseCount > 0 && stats.executedCaseCount === stats.testCaseCount,
      detail: `${stats.executedCaseCount} of ${stats.testCaseCount} test cases have actually been run${
        executionCoveragePercent === null ? "" : ` (${executionCoveragePercent}%)`
      }.`,
    },
    {
      check: "No failing test cases",
      met: hasExecutionData && stats.testCasesByStatus.Fail === 0,
      detail: `${stats.testCasesByStatus.Fail} test case(s) are currently failing.`,
    },
    {
      check: "No blocked test cases",
      met: blockedCases === 0,
      detail: `${blockedCases} test case(s) are blocked.`,
    },
    {
      check: "No open Critical/High defects",
      met: criticalOpen.length === 0,
      detail: `${criticalOpen.length} open Critical/High defect(s)${
        criticalOpen.length > 0 ? `: ${criticalOpen.map((b) => b.bugId).join(", ")}` : ""
      }.`,
    },
    {
      check: "Requirement coverage complete",
      met:
        stats.requirementCount > 0 &&
        stats.requirementsWithTestCases === stats.requirementCount,
      detail: `${stats.requirementsWithTestCases} of ${stats.requirementCount} requirements have at least one test case.`,
    },
  ];

  return {
    reportKind: kind,
    generatedAt: new Date().toISOString(),

    // The single most important flag for report honesty. When false, there is
    // no execution story to tell and the report must say so instead of
    // presenting design counts as results.
    hasExecutionData,
    executionDataCaveat: hasExecutionData
      ? null
      : "No tests have been executed for this project. Any 'Test Execution', 'Regression', or 'Release Readiness' report can only describe test DESIGN, and must say plainly that nothing has been run — do not present written test cases as executed, and do not state a pass rate.",

    design: {
      requirementCount: stats.requirementCount,
      assumptionCount: stats.assumptionCount,
      scenarioCount: stats.scenarioCount,
      testCaseCount: stats.testCaseCount,
      scriptCount: stats.scriptCount,
      requirementsWithTestCases: stats.requirementsWithTestCases,
      requirementCoveragePercent: pct(stats.requirementsWithTestCases, stats.requirementCount),
    },

    execution: {
      runCount: stats.runCount,
      executionCount: stats.executionCount,
      executionPassCount: stats.executionPassCount,
      executionFailCount: stats.executionFailCount,
      // Across all recorded executions, historical.
      overallPassRatePercent: pct(stats.executionPassCount, stats.executionCount),
      // Of the cases that ran, how many currently sit at Pass.
      currentPassRatePercent,
      executedCaseCount: stats.executedCaseCount,
      notRunCaseCount: stats.testCasesByStatus.NotRun,
      executionCoveragePercent,
      testCasesByStatus: stats.testCasesByStatus,
      lastRun: stats.lastRun,
      topFailingCases: stats.topFailingCases,
      byModule,
      runHistory,
      failingCases: executedCases
        .filter((c) => c.status === "Fail")
        .map((c) => ({
          caseId: c.caseId,
          module: c.module,
          priority: c.priority,
          severity: c.severity,
          actualResult: c.actualResult,
          lastExecutedAt: c.lastExecutedAt?.toISOString() ?? null,
        })),
      notRunCases: notRunCases.slice(0, 50).map((c) => ({
        caseId: c.caseId,
        module: c.module,
        priority: c.priority,
      })),
    },

    defects: {
      total: bugs.length,
      open: openBugs.length,
      openCriticalHigh: criticalOpen.length,
      byStatus: stats.bugsByStatus,
      bySeverity: stats.bugsBySeverity,
      // How many defects are backed by a real execution — a defect with
      // attachments came from a run, one without came from analysis.
      fromExecution: bugs.filter((b) => b.attachmentsJson !== null).length,
      list: bugs.map((b) => ({
        bugId: b.bugId,
        title: b.title,
        module: b.module,
        severity: b.severity,
        priority: b.priority,
        status: b.status,
        environment: b.environment,
        sourceTestCase: b.sourceTestCase,
        dateReported: b.dateReported.toISOString(),
        hasEvidence: b.attachmentsJson !== null,
      })),
    },

    benchmark: {
      rowCount: stats.benchmarkRowCount,
      passCount: stats.benchmarkPassCount,
      failCount: stats.benchmarkFailCount,
      passRatePercent: pct(stats.benchmarkPassCount, stats.benchmarkRowCount),
      avgScore: stats.benchmarkAvgScore,
    },

    releaseReadiness: {
      checks: readinessChecks,
      met: readinessChecks.filter((c) => c.met).length,
      total: readinessChecks.length,
      // Deliberately not a "ready: true/false" verdict — the call belongs to
      // the reader, and a boolean would hide which condition failed.
      blockers: readinessChecks.filter((c) => !c.met).map((c) => c.check),
    },
  };
}
