import { authenticate } from './e2e/auth';
import { streamChat } from './e2e/sse-client';
import { LocalToolExecutor } from './e2e/tool-executor';
import { TEST_CASES } from './e2e/test-cases';
import type { TestResult, ChatHistoryMessage } from './e2e/types';

// ─── Configuration ───────────────────────────────────────────────

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const MAX_TOOL_ITERATIONS = 40;
const MAX_CONSECUTIVE_FAILURES = 3;
const GCP_POLL_INTERVAL_MS = 5_000;
const GCP_POLL_TIMEOUT_MS = 120_000;
const MAX_RETRIES_PER_ITERATION = 3;

// ─── Helpers ─────────────────────────────────────────────────────

function elapsed(start: number): string {
  return ((Date.now() - start) / 1000).toFixed(1) + 's';
}

function loadEnv(): { email: string; password: string; apiKey: string } {
  // Try loading .env.local manually for tsx scripts
  try {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '..', '.env.local');
    const envContent = fs.readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env.local not found — rely on environment
  }

  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

  if (!email || !password) {
    console.error('Missing E2E_TEST_EMAIL and/or E2E_TEST_PASSWORD environment variables.');
    console.error('Add them to .env.local or export them before running.');
    process.exit(1);
  }
  if (!apiKey) {
    console.error('Missing NEXT_PUBLIC_FIREBASE_API_KEY. Check .env.local.');
    process.exit(1);
  }

  return { email, password, apiKey };
}

// ─── Project Creation ────────────────────────────────────────────

async function createProject(sessionCookie: string, name: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `session=${sessionCookie}`,
    },
    body: JSON.stringify({ name }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Failed to create project: ${res.status} ${err}`);
  }

  const { id } = await res.json();
  return id;
}

// ─── GCP Readiness Check ────────────────────────────────────────

async function waitForGcp(sessionCookie: string, projectId: string): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < GCP_POLL_TIMEOUT_MS) {
    try {
      const res = await fetch(`${BASE_URL}/api/projects/${projectId}/deploy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `session=${sessionCookie}`,
        },
        body: JSON.stringify({ files: {} }),
      });

      const body = await res.json().catch(() => ({}));
      const error = body.error || '';

      // These errors mean GCP isn't ready yet
      if (
        error.includes('still being set up') ||
        error.includes('provisioning') ||
        error.includes('not ready')
      ) {
        await new Promise((r) => setTimeout(r, GCP_POLL_INTERVAL_MS));
        continue;
      }

      // Any other response (even a different error like "No files") means GCP is ready
      return;
    } catch {
      await new Promise((r) => setTimeout(r, GCP_POLL_INTERVAL_MS));
    }
  }

  throw new Error(`GCP not ready after ${GCP_POLL_TIMEOUT_MS / 1000}s`);
}

// ─── Agentic Loop ────────────────────────────────────────────────

async function runAgenticLoop(
  sessionCookie: string,
  projectId: string,
  prompt: string,
  executor: LocalToolExecutor,
  timeoutMs: number,
): Promise<{ iterations: number; toolCallCount: number; content: string; error?: string }> {
  const chatHistory: ChatHistoryMessage[] = [];
  let totalToolCalls = 0;
  let consecutiveFailures = 0;
  let lastContent = '';

  for (let iteration = 1; iteration <= MAX_TOOL_ITERATIONS; iteration++) {
    // First iteration: send prompt with empty history
    // Subsequent: send empty message with full history (tool results included)
    const messageToSend = iteration === 1 ? prompt : '';
    const historyToSend = iteration === 1 ? [] : chatHistory;

    if (iteration === 1) {
      // Add user message to history for tracking
      chatHistory.push({ role: 'user', content: prompt });
    }

    let retryCount = 0;
    let streamResult: Awaited<ReturnType<typeof streamChat>> | null = null;

    while (retryCount < MAX_RETRIES_PER_ITERATION) {
      try {
        streamResult = await streamChat(
          BASE_URL,
          sessionCookie,
          projectId,
          messageToSend,
          historyToSend,
          async (tc) => {
            const result = await executor.execute(tc);
            // Track consecutive failures
            if (result?.success === false) {
              consecutiveFailures++;
            } else {
              consecutiveFailures = 0;
            }
            return result;
          },
        );
        break;
      } catch (err: any) {
        retryCount++;
        if (retryCount >= MAX_RETRIES_PER_ITERATION) {
          return {
            iterations: iteration,
            toolCallCount: totalToolCalls,
            content: lastContent,
            error: `Chat API error after ${retryCount} retries: ${err.message}`,
          };
        }
        console.log(`    Retry ${retryCount}/${MAX_RETRIES_PER_ITERATION}: ${err.message}`);
        await new Promise((r) => setTimeout(r, 10_000 * retryCount));
      }
    }

    if (!streamResult) {
      return {
        iterations: iteration,
        toolCallCount: totalToolCalls,
        content: lastContent,
        error: 'No stream result',
      };
    }

    const { content, toolCalls, error } = streamResult;
    lastContent = content;
    totalToolCalls += toolCalls.length;

    // Log progress
    const toolNames = toolCalls.map((tc) => tc.name);
    const toolSummary = toolNames.length > 0 ? toolNames.join(', ') : 'no tools';
    const textPreview = content.slice(0, 80).replace(/\n/g, ' ');
    console.log(`    [${iteration}] ${toolCalls.length} tools (${toolSummary}) | "${textPreview}..."`);

    // Handle retryable error from SSE
    if (error) {
      console.log(`    SSE error: ${error}`);
      // If retryable, wait and continue the loop (the iteration will retry)
      if (error.includes('busy') || error.includes('wait')) {
        await new Promise((r) => setTimeout(r, 30_000));
        continue;
      }
      return {
        iterations: iteration,
        toolCallCount: totalToolCalls,
        content: lastContent,
        error,
      };
    }

    // Check consecutive failures
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      return {
        iterations: iteration,
        toolCallCount: totalToolCalls,
        content: lastContent,
        error: `${MAX_CONSECUTIVE_FAILURES} consecutive tool failures`,
      };
    }

    // No tool calls → AI is done
    if (toolCalls.length === 0) {
      return {
        iterations: iteration,
        toolCallCount: totalToolCalls,
        content: lastContent,
      };
    }

    // Build history for next iteration
    chatHistory.push({
      role: 'assistant',
      content,
      toolCalls: toolCalls.map((tc) => ({ id: tc.id, name: tc.name, args: tc.args })),
    });

    chatHistory.push({
      role: 'user',
      toolResults: toolCalls.map((tc) => ({ name: tc.name, result: tc.result })),
    });
  }

  return {
    iterations: MAX_TOOL_ITERATIONS,
    toolCallCount: totalToolCalls,
    content: lastContent,
    error: `Reached max iterations (${MAX_TOOL_ITERATIONS})`,
  };
}

// ─── Deploy Verification ─────────────────────────────────────────

async function verifyDeployment(
  url: string,
  verifyFn: (html: string) => boolean,
  needsBuild: boolean,
): Promise<{ passed: boolean; error?: string }> {
  try {
    // Wait a moment for deployment propagation
    await new Promise((r) => setTimeout(r, 5_000));

    // Step 1: Fetch HTML
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) {
      return { passed: false, error: `Deploy URL returned ${res.status}` };
    }

    const html = await res.text();

    // Step 2: Basic content verification
    if (!verifyFn(html)) {
      return { passed: false, error: 'HTML content check failed — deployed content does not match expectations' };
    }

    // Step 3: Extract and verify assets (for built apps)
    if (needsBuild) {
      // Extract script and CSS URLs from HTML
      const scriptMatches = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)];
      const cssMatches = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)];
      const assetUrls = [
        ...scriptMatches.map((m) => m[1]),
        ...cssMatches.map((m) => m[1]),
      ];

      if (assetUrls.length === 0) {
        return { passed: false, error: 'No script or CSS assets found in HTML — app has no bundled code' };
      }

      // Fetch each asset and verify it loads
      for (const assetPath of assetUrls) {
        const assetUrl = assetPath.startsWith('http') ? assetPath : new URL(assetPath, url).href;
        try {
          const assetRes = await fetch(assetUrl);
          if (!assetRes.ok) {
            return { passed: false, error: `Asset ${assetPath} returned ${assetRes.status}` };
          }
          const assetBody = await assetRes.text();
          if (!assetBody || assetBody.length < 10) {
            return { passed: false, error: `Asset ${assetPath} is empty or too small` };
          }

          // Step 4: Bundle analysis for JS files
          if (assetPath.endsWith('.js')) {
            // Check for placeholder Firebase configs
            if (assetBody.includes('YOUR_API_KEY') || assetBody.includes('YOUR_PROJECT_ID')) {
              return { passed: false, error: 'JS bundle contains placeholder Firebase config (YOUR_API_KEY)' };
            }

            // If the bundle references Firebase/Firestore, check it has a real apiKey
            const usesFirebase =
              assetBody.includes('initializeApp') &&
              (assetBody.includes('firestore') || assetBody.includes('Firestore'));

            if (usesFirebase) {
              // Look for an apiKey pattern (Firebase API keys start with "AIza")
              const hasApiKey = /AIza[A-Za-z0-9_-]{30,}/.test(assetBody);
              if (!hasApiKey) {
                return {
                  passed: false,
                  error: 'JS bundle uses Firebase/Firestore but has no valid apiKey (missing "AIza..." pattern). Firebase client config is incomplete.',
                };
              }
              console.log('    Bundle check: Firebase config with valid apiKey found');
            }
          }
        } catch (assetErr: any) {
          return { passed: false, error: `Failed to fetch asset ${assetPath}: ${assetErr.message}` };
        }
      }

      console.log(`    Assets verified: ${assetUrls.length} file(s) loaded OK`);
    }

    return { passed: true };
  } catch (err: any) {
    return { passed: false, error: `Failed to fetch deploy URL: ${err.message}` };
  }
}

// ─── Run Single Test ─────────────────────────────────────────────

async function runTest(
  sessionCookie: string,
  testCase: typeof TEST_CASES[number],
): Promise<TestResult> {
  const start = Date.now();
  const result: TestResult = {
    name: testCase.name,
    passed: false,
    duration: 0,
    iterations: 0,
    toolCallCount: 0,
  };

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Test timed out after ${testCase.timeoutMs / 1000}s`)), testCase.timeoutMs)
  );

  try {
    await Promise.race([
      (async () => {
        // Step 1: Create project
        console.log('  Creating project...');
        const projectId = await createProject(sessionCookie, `E2E Test: ${testCase.name}`);
        result.projectId = projectId;
        console.log(`  Project: ${projectId}`);

        // Step 2: Wait for GCP
        console.log('  Waiting for GCP provisioning...');
        const gcpStart = Date.now();
        await waitForGcp(sessionCookie, projectId);
        console.log(`  GCP ready (${elapsed(gcpStart)})`);

        // Step 3: Initialize tool executor
        const executor = new LocalToolExecutor(projectId, sessionCookie, BASE_URL);
        await executor.initialize();

        try {
          // Step 4: Run agentic loop
          console.log('  Running agentic loop...');
          const loopResult = await runAgenticLoop(
            sessionCookie,
            projectId,
            testCase.prompt,
            executor,
            testCase.timeoutMs,
          );

          result.iterations = loopResult.iterations;
          result.toolCallCount = loopResult.toolCallCount;
          console.log(`  Loop: ${loopResult.iterations} iterations, ${loopResult.toolCallCount} tool calls`);

          if (loopResult.error) {
            console.log(`  Loop warning: ${loopResult.error}`);
          }

          // Step 5: Check if AI already deployed
          let deployUrl = executor.getDeployUrl();

          // Step 6: If not deployed yet, try deploying ourselves
          if (!deployUrl) {
            console.log('  AI did not deploy — running deploy...');
            const deployResult = await executor.deploy();
            if (deployResult.success && deployResult.url) {
              deployUrl = deployResult.url;
            } else {
              throw new Error(`Deploy failed: ${deployResult.error}`);
            }
          }

          result.deployUrl = deployUrl!;
          console.log(`  Deploy URL: ${deployUrl}`);

          // Step 7: Verify deployment
          console.log('  Verifying deployment...');
          const verification = await verifyDeployment(deployUrl!, testCase.verifyDeploy, testCase.needsBuild);

          if (verification.passed) {
            result.passed = true;
          } else {
            result.error = verification.error;
          }
        } finally {
          await executor.cleanup();
        }
      })(),
      timeoutPromise,
    ]);
  } catch (err: any) {
    result.error = err.message;
  }

  result.duration = (Date.now() - start) / 1000;
  return result;
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const { email, password, apiKey } = loadEnv();

  // Parse CLI args for filtering
  const filterArg = process.argv[2]?.toLowerCase();
  const testsToRun = filterArg
    ? TEST_CASES.filter(
        (tc) =>
          tc.name.toLowerCase().includes(filterArg) ||
          tc.complexity.toLowerCase() === filterArg,
      )
    : TEST_CASES;

  if (testsToRun.length === 0) {
    console.error(`No tests match filter: "${filterArg}"`);
    console.error('Available tests:');
    for (const tc of TEST_CASES) {
      console.error(`  [${tc.complexity}] ${tc.name}`);
    }
    process.exit(1);
  }

  console.log(`\nE2E Test Runner — ${testsToRun.length} test(s) selected`);
  console.log(`Base URL: ${BASE_URL}\n`);

  // Authenticate
  console.log('Authenticating...');
  let sessionCookie: string;
  try {
    sessionCookie = await authenticate(email, password, apiKey, BASE_URL);
    console.log('Authenticated OK\n');
  } catch (err: any) {
    console.error(`Authentication failed: ${err.message}`);
    process.exit(1);
  }

  // Run tests sequentially (to avoid overwhelming the AI/API)
  const results: TestResult[] = [];

  for (const testCase of testsToRun) {
    console.log('='.repeat(60));
    console.log(`Running: ${testCase.name} (${testCase.complexity})`);
    console.log('='.repeat(60));

    const result = await runTest(sessionCookie, testCase);
    results.push(result);

    const status = result.passed ? 'PASS' : 'FAIL';
    const errorMsg = result.error ? ` — ${result.error}` : '';
    console.log(`\n[${status}] ${result.name} (${result.duration.toFixed(1)}s)${errorMsg}`);
    if (result.deployUrl) {
      console.log(`  Deploy: ${result.deployUrl}`);
    }
    console.log('');
  }

  // Summary
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  console.log(`Passed: ${passed}/${results.length}`);
  if (failed > 0) console.log(`Failed: ${failed}/${results.length}`);
  console.log('');

  for (const r of results) {
    const status = r.passed ? 'PASS' : 'FAIL';
    const errorMsg = r.error ? ` — ${r.error.slice(0, 100)}` : '';
    console.log(`  [${status}] ${r.name} (${r.duration.toFixed(1)}s)${errorMsg}`);
    if (r.deployUrl) {
      console.log(`         ${r.deployUrl}`);
    }
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
