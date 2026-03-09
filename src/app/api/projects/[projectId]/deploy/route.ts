import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { verifySession } from '@/lib/auth/verify-session';
import { deployToHosting } from '@/lib/gcp/firebase-hosting';
import { smGetSecretValue } from '@/app/api/projects/[projectId]/secrets/route';
import { mkdtemp, writeFile, rm, readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

/**
 * Build source files server-side using real Node.js.
 * WebContainer's wasm runtime can't handle Vite builds reliably,
 * so we build on the server where we have full resources.
 */
async function buildOnServer(sourceFiles: Record<string, string>): Promise<Record<string, string>> {
  const tempDir = await mkdtemp(join(tmpdir(), 'gogobot-build-'));

  try {
    // Write all source files to temp directory
    for (const [filePath, content] of Object.entries(sourceFiles)) {
      const fullPath = join(tempDir, filePath);
      const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
      await execMkdir(dir);
      await writeFile(fullPath, content, 'utf-8');
    }

    // Check if there's a build script
    const pkgPath = join(tempDir, 'package.json');
    let hasBuildScript = false;
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
      hasBuildScript = !!pkg.scripts?.build;
    } catch {
      // No package.json — just deploy source files as-is
    }

    if (!hasBuildScript) {
      // No build needed — return source files directly
      return sourceFiles;
    }

    // Install dependencies and build
    console.log(`Building in ${tempDir}...`);
    try {
      execSync('npm install --force', {
        cwd: tempDir,
        timeout: 120_000,
        stdio: 'pipe',
        // Don't set NODE_ENV=production here — devDependencies like vite are needed for the build
        env: { ...process.env, NODE_ENV: 'development' },
      });
    } catch (e: any) {
      const stderr = e.stderr?.toString()?.slice(-500) || '';
      const stdout = e.stdout?.toString()?.slice(-500) || '';
      throw new Error(`npm install failed: ${stderr || stdout}`);
    }

    try {
      execSync('npm run build', {
        cwd: tempDir,
        timeout: 120_000,
        stdio: 'pipe',
        env: { ...process.env, NODE_ENV: 'production' },
      });
    } catch (e: any) {
      const stderr = e.stderr?.toString()?.slice(-500) || '';
      const stdout = e.stdout?.toString()?.slice(-500) || '';
      throw new Error(`Build failed: ${stderr || stdout}`);
    }

    // Read built files from dist/
    const distDir = join(tempDir, 'dist');
    const builtFiles: Record<string, string> = {};
    await readDirRecursive(distDir, '', builtFiles);

    if (Object.keys(builtFiles).length === 0) {
      throw new Error('Build produced no output in dist/');
    }

    console.log(`Build produced ${Object.keys(builtFiles).length} files`);
    return builtFiles;
  } finally {
    // Clean up temp directory
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function execMkdir(dir: string): Promise<void> {
  const { mkdir } = await import('fs/promises');
  await mkdir(dir, { recursive: true });
}

async function readDirRecursive(
  dirPath: string,
  prefix: string,
  result: Record<string, string>
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dirPath);
  } catch {
    return; // Directory doesn't exist
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    const relativePath = prefix ? `${prefix}/${entry}` : entry;
    const stats = await stat(fullPath);

    if (stats.isDirectory()) {
      await readDirRecursive(fullPath, relativePath, result);
    } else {
      try {
        result[relativePath] = await readFile(fullPath, 'utf-8');
      } catch {
        // Skip binary files
      }
    }
  }
}

/**
 * Replace __ENV__{NAME}__ placeholders in file contents with actual secret values
 * from Google Cloud Secret Manager.
 */
async function injectSecrets(
  projectId: string,
  files: Record<string, string>
): Promise<Record<string, string>> {
  // Find all unique __ENV__{NAME}__ placeholders across all files
  const placeholderRegex = /__ENV__([A-Za-z_][A-Za-z0-9_]*)__/g;
  const neededSecrets = new Set<string>();

  for (const content of Object.values(files)) {
    let match;
    while ((match = placeholderRegex.exec(content)) !== null) {
      neededSecrets.add(match[1]);
    }
  }

  if (neededSecrets.size === 0) return files;

  // Fetch all needed secret values in parallel
  const secretValues = new Map<string, string>();
  const fetchResults = await Promise.allSettled(
    Array.from(neededSecrets).map(async (name) => {
      const secretId = `gogobot-${projectId}-${name}`;
      const value = await smGetSecretValue(secretId);
      return { name, value };
    })
  );

  for (const result of fetchResults) {
    if (result.status === 'fulfilled') {
      secretValues.set(result.value.name, result.value.value);
    } else {
      console.warn(`Failed to fetch secret for injection:`, result.reason);
    }
  }

  if (secretValues.size === 0) return files;

  // Replace placeholders in all text files
  const injectedFiles: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    injectedFiles[path] = content.replace(placeholderRegex, (fullMatch, name) => {
      return secretValues.get(name) ?? fullMatch;
    });
  }

  console.log(`Injected ${secretValues.size} secret(s) into deploy files`);
  return injectedFiles;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const user = await verifySession();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await params;
    const db = getAdminDb();
    const projectRef = db.collection('projects').doc(projectId);
    const projectDoc = await projectRef.get();

    if (!projectDoc.exists || projectDoc.data()?.userId !== user.uid) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const project = projectDoc.data()!;

    // Check GCP project is ready
    if (!project.gcpProject?.hostingSiteId) {
      return NextResponse.json(
        { error: 'Cloud infrastructure is still being set up. Please wait a moment and try again.' },
        { status: 400 }
      );
    }

    if (project.gcpProject?.status !== 'ready') {
      return NextResponse.json(
        { error: `Cloud project is ${project.gcpProject?.status || 'not ready'}. Cannot deploy yet.` },
        { status: 400 }
      );
    }

    // Get files from request body or from latest snapshot
    const body = await request.json().catch(() => ({}));
    let files = body.files;

    if (!files || Object.keys(files).length === 0) {
      const snapshotsRef = projectRef.collection('snapshots');
      const latestSnapshot = await snapshotsRef
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();

      if (!latestSnapshot.empty) {
        files = latestSnapshot.docs[0].data().files || {};
      }
    }

    if (!files || Object.keys(files).length === 0) {
      return NextResponse.json(
        { error: 'No files to deploy. Build something first!' },
        { status: 400 }
      );
    }

    // Ensure we have an index.html (source or built)
    if (!files['index.html'] && !files['public/index.html']) {
      return NextResponse.json(
        { error: 'No index.html found. Your project needs an index.html file.' },
        { status: 400 }
      );
    }

    // Update project status
    await projectRef.update({
      status: 'deploying',
      updatedAt: new Date(),
    });

    try {
      // Build on the server if the project has JSX/TS that needs compilation
      let deployFiles = files;
      const needsBuild = Object.keys(files).some(f =>
        /\.(jsx|tsx|ts)$/.test(f) && !f.includes('node_modules')
      );

      if (needsBuild) {
        console.log('Project needs build — building server-side...');
        deployFiles = await buildOnServer(files);
      }

      // Inject secret values into __ENV__{NAME}__ placeholders
      deployFiles = await injectSecrets(projectId, deployFiles);

      // Deploy to the project's own Firebase Hosting site
      const deployResult = await deployToHosting(
        project.gcpProject.hostingSiteId,
        deployFiles
      );

      if (deployResult.success) {
        const deployUrl = deployResult.url || project.gcpProject.hostingUrl;

        await projectRef.update({
          status: 'deployed',
          deployment: {
            url: deployUrl,
            deployedAt: new Date(),
          },
          updatedAt: new Date(),
        });

        // Save deployment history
        await projectRef.collection('deployments').add({
          url: deployUrl,
          versionId: deployResult.versionId,
          deployedAt: new Date(),
          deployedBy: user.uid,
        });

        return NextResponse.json({
          success: true,
          url: deployUrl,
          message: `Deployed to ${deployUrl}`,
        });
      } else {
        await projectRef.update({
          status: 'error',
          updatedAt: new Date(),
        });

        return NextResponse.json(
          { error: deployResult.error || 'Deployment failed' },
          { status: 500 }
        );
      }
    } catch (deployError: any) {
      await projectRef.update({
        status: 'error',
        updatedAt: new Date(),
      });

      throw deployError;
    }
  } catch (error: any) {
    console.error('Deploy error:', error);
    return NextResponse.json(
      { error: error.message || 'Deployment failed' },
      { status: 500 }
    );
  }
}

// GET /api/projects/[projectId]/deploy - Get deployment status
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const user = await verifySession();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await params;
    const db = getAdminDb();
    const projectDoc = await db.collection('projects').doc(projectId).get();

    if (!projectDoc.exists || projectDoc.data()?.userId !== user.uid) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const project = projectDoc.data()!;

    return NextResponse.json({
      status: project.status,
      deployment: project.deployment || null,
      gcpProject: project.gcpProject || null,
    });
  } catch (error: any) {
    console.error('Get deployment status error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get deployment status' },
      { status: 500 }
    );
  }
}
