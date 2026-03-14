import { WebContainer, FileSystemTree } from '@webcontainer/api';

const MAX_CONSOLE_LINES = 200;
const MAX_ERROR_LINES = 100;

// Store singleton on globalThis so it survives HMR / module re-evaluation
const _g = globalThis as any;

export class WebContainerManager {
  private static get instance(): WebContainer | null { return _g.__wcInstance ?? null; }
  private static set instance(v: WebContainer | null) { _g.__wcInstance = v; }
  private static get bootPromise(): Promise<WebContainer> | null { return _g.__wcBootPromise ?? null; }
  private static set bootPromise(v: Promise<WebContainer> | null) { _g.__wcBootPromise = v; }
  private static get serverReadyListenerAttached(): boolean { return _g.__wcListenerAttached ?? false; }
  private static set serverReadyListenerAttached(v: boolean) { _g.__wcListenerAttached = v; }
  private static get devServerUrl(): string | null { return _g.__wcDevServerUrl ?? null; }
  private static set devServerUrl(v: string | null) { _g.__wcDevServerUrl = v; }
  private static get devServerProcess(): { kill: () => void } | null { return _g.__wcDevServerProcess ?? null; }
  private static set devServerProcess(v: { kill: () => void } | null) { _g.__wcDevServerProcess = v; }
  private consoleBuffer: string[] = [];
  private errorBuffer: string[] = [];

  async initialize(projectId: string, initialFiles?: FileSystemTree): Promise<void> {
    // Boot WebContainer (singleton pattern - only boot once per page load)
    // Instance & bootPromise live on globalThis so they survive HMR module re-evaluation
    if (!WebContainerManager.instance) {
      if (!WebContainerManager.bootPromise) {
        console.log('Booting WebContainer...');
        WebContainerManager.bootPromise = WebContainer.boot();
      }
      WebContainerManager.instance = await WebContainerManager.bootPromise;
      console.log('WebContainer booted successfully');
    }

    const container = WebContainerManager.instance;

    // Mount initial files if provided
    if (initialFiles) {
      await container.mount(initialFiles);
      console.log('Mounted initial files');
    } else {
      // Create default project structure
      await container.mount({
        'package.json': {
          file: {
            contents: JSON.stringify(
              {
                name: 'project',
                type: 'module',
                dependencies: {},
                devDependencies: {
                  vite: '^5.0.0',
                },
                scripts: {
                  dev: 'vite',
                  build: 'vite build',
                },
              },
              null,
              2
            ),
          },
        },
        'index.html': {
          file: {
            contents: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Gogobot Project</title>
  </head>
  <body>
    <div id="root">
      <h1>Welcome to Gogobot!</h1>
      <p>Start chatting to build your app.</p>
    </div>
  </body>
</html>`,
          },
        },
      });
      console.log('Created default project structure');
    }

    // Listen for server-ready event (only once per WebContainer boot)
    if (!WebContainerManager.serverReadyListenerAttached) {
      WebContainerManager.serverReadyListenerAttached = true;
      container.on('server-ready', (port, url) => {
        WebContainerManager.devServerUrl = url;
        console.log(`Dev server ready at ${url} (port ${port})`);
      });
    }
  }

  private addToConsoleBuffer(line: string): void {
    this.consoleBuffer.push(line);
    if (this.consoleBuffer.length > MAX_CONSOLE_LINES) {
      this.consoleBuffer.shift();
    }
  }

  private addToErrorBuffer(line: string): void {
    this.errorBuffer.push(line);
    if (this.errorBuffer.length > MAX_ERROR_LINES) {
      this.errorBuffer.shift();
    }
  }

  async installDependencies(): Promise<{ success: boolean; output: string }> {
    const container = WebContainerManager.instance;
    if (!container) throw new Error('Container not initialized');

    console.log('Installing dependencies...');
    // --force bypasses platform checks (needed for Tailwind v4's @tailwindcss/oxide in WebContainers)
    const install = await container.spawn('npm', ['install', '--force']);

    let output = '';
    install.output.pipeTo(
      new WritableStream({
        write: (chunk) => {
          output += chunk;
          // Also capture to console buffer
          const lines = chunk.split('\n').filter((l: string) => l.trim());
          for (const line of lines) {
            this.addToConsoleBuffer(line);
            if (/error|Error|FAIL|ERR!/i.test(line)) {
              this.addToErrorBuffer(line);
            }
          }
        },
      })
    );

    const exitCode = await install.exit;
    const success = exitCode === 0;

    console.log(`npm install ${success ? 'succeeded' : 'failed'}`);
    return { success, output };
  }

  async startDevServer(): Promise<void> {
    const container = WebContainerManager.instance;
    if (!container) throw new Error('Container not initialized');

    console.log('Starting dev server...');
    const dev = await container.spawn('npm', ['run', 'dev']);
    WebContainerManager.devServerProcess = dev;

    // Capture output to console and error buffers
    dev.output.pipeTo(
      new WritableStream({
        write: (chunk) => {
          const lines = chunk.split('\n').filter((l: string) => l.trim());
          for (const line of lines) {
            this.addToConsoleBuffer(line);
            if (/error|Error|FAIL|ERR!/i.test(line)) {
              this.addToErrorBuffer(line);
            }
          }
        },
      })
    );
  }

  private async stopDevServer(): Promise<void> {
    if (WebContainerManager.devServerProcess) {
      console.log('Stopping dev server for build...');
      try { WebContainerManager.devServerProcess.kill(); } catch {}
      WebContainerManager.devServerProcess = null;
      WebContainerManager.devServerUrl = null;
      // Give it a moment to release resources
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    const container = WebContainerManager.instance;
    if (!container) throw new Error('Container not initialized');

    // Create parent directories if they don't exist
    const parts = path.split('/');
    if (parts.length > 1) {
      let currentPath = '';
      for (let i = 0; i < parts.length - 1; i++) {
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
        try {
          await container.fs.readdir(currentPath);
        } catch {
          await container.fs.mkdir(currentPath);
        }
      }
    }

    await container.fs.writeFile(path, content);
  }

  async readFile(path: string): Promise<string> {
    const container = WebContainerManager.instance;
    if (!container) throw new Error('Container not initialized');

    try {
      const content = await container.fs.readFile(path, 'utf-8');
      return content;
    } catch (error: any) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot read file "${path}": ${detail}`);
    }
  }

  async patchFile(path: string, oldContent: string, newContent: string): Promise<void> {
    const container = WebContainerManager.instance;
    if (!container) throw new Error('Container not initialized');

    const currentContent = await container.fs.readFile(path, 'utf-8');

    // Try exact match first
    if (currentContent.includes(oldContent)) {
      const updatedContent = currentContent.replace(oldContent, newContent);
      await container.fs.writeFile(path, updatedContent);
      return;
    }

    // Fuzzy match: normalize whitespace (trim trailing spaces per line, normalize line endings)
    const normalize = (s: string) => s.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '');
    const normalizedCurrent = normalize(currentContent);
    const normalizedOld = normalize(oldContent);

    if (normalizedCurrent.includes(normalizedOld)) {
      // Find the actual substring in the original by matching line-by-line
      const oldLines = normalizedOld.split('\n');
      const currentLines = currentContent.split(/\r?\n/);

      for (let i = 0; i <= currentLines.length - oldLines.length; i++) {
        const slice = currentLines.slice(i, i + oldLines.length);
        if (slice.every((line, j) => normalize(line) === oldLines[j])) {
          // Found the matching region — replace those lines
          const before = currentLines.slice(0, i).join('\n');
          const after = currentLines.slice(i + oldLines.length).join('\n');
          const prefix = before ? before + '\n' : '';
          const suffix = after ? '\n' + after : '';
          await container.fs.writeFile(path, prefix + newContent + suffix);
          return;
        }
      }
    }

    // No match found — include the actual file content so the AI can retry
    const truncated = currentContent.length > 2000
      ? currentContent.slice(0, 2000) + '\n... (truncated)'
      : currentContent;
    throw new Error(
      `Could not find the specified text in ${path}. The file may have been modified. Use readFile to see the current content, or here it is:\n\n${truncated}`
    );
  }

  async deleteFile(path: string): Promise<void> {
    const container = WebContainerManager.instance;
    if (!container) throw new Error('Container not initialized');

    try {
      await container.fs.rm(path, { recursive: true });
    } catch (error: any) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to delete "${path}": ${detail}`);
    }
  }

  async listFiles(path: string = '.'): Promise<string[]> {
    const container = WebContainerManager.instance;
    if (!container) throw new Error('Container not initialized — WebContainer may still be booting or was destroyed');

    try {
      const entries = await container.fs.readdir(path, { withFileTypes: true });
      // Return entries with type indicator (/ for directories)
      return entries.map(entry => entry.isDirectory() ? `${entry.name}/` : entry.name);
    } catch (error: any) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot list directory "${path}": ${detail}`);
    }
  }

  async searchFiles(
    pattern: string,
    path: string = '.',
    filePattern?: string
  ): Promise<Array<{ file: string; line: number; content: string }>> {
    const container = WebContainerManager.instance;
    if (!container) throw new Error('Container not initialized');

    const results: Array<{ file: string; line: number; content: string }> = [];

    const walkAndSearch = async (dirPath: string) => {
      try {
        const entries = await container.fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = dirPath === '.' ? entry.name : `${dirPath}/${entry.name}`;

          // Skip node_modules and hidden directories
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

          if (entry.isDirectory()) {
            await walkAndSearch(fullPath);
          } else if (entry.isFile()) {
            // Apply file extension filter
            if (filePattern && !fullPath.endsWith(filePattern)) continue;

            try {
              const content = await container.fs.readFile(fullPath, 'utf-8');
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].toLowerCase().includes(pattern.toLowerCase())) {
                  results.push({
                    file: fullPath,
                    line: i + 1,
                    content: lines[i].trim(),
                  });
                }
              }
            } catch {
              // Skip binary or unreadable files
            }
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    };

    await walkAndSearch(path);
    return results.slice(0, 50); // Limit results
  }

  async runCommand(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const container = WebContainerManager.instance;
    if (!container) throw new Error('Container not initialized');

    const [cmd, ...args] = command.split(' ');
    const process = await container.spawn(cmd, args);

    let stdout = '';
    let stderr = '';

    process.output.pipeTo(
      new WritableStream({
        write: (chunk) => {
          stdout += chunk;
          // Also capture to console buffer
          const lines = chunk.split('\n').filter((l: string) => l.trim());
          for (const line of lines) {
            this.addToConsoleBuffer(line);
            if (/error|Error|FAIL|ERR!/i.test(line)) {
              this.addToErrorBuffer(line);
            }
          }
        },
      })
    );

    const exitCode = await process.exit;

    return { stdout, stderr, exitCode };
  }

  getConsoleOutput(lines: number = 50): string[] {
    return this.consoleBuffer.slice(-lines);
  }

  getErrors(): string[] {
    return this.errorBuffer.slice(-50);
  }

  getPreviewUrl(): string | null {
    return WebContainerManager.devServerUrl;
  }

  /**
   * Run `npm run build` (vite build) and return the built files from dist/.
   * Returns a flat map of path → content for deployment.
   */
  async buildForDeploy(): Promise<Record<string, string>> {
    const container = WebContainerManager.instance;
    if (!container) throw new Error('Container not initialized');

    // Check if package.json has a build script
    try {
      const pkgJson = await container.fs.readFile('package.json', 'utf-8');
      const pkg = JSON.parse(pkgJson);
      if (!pkg.scripts?.build) {
        throw new Error('No build script in package.json');
      }
    } catch (e: any) {
      if (e.message.includes('No build script')) throw e;
      throw new Error('Could not read package.json');
    }

    // Stop the dev server to free up resources — WebContainer can't run both
    await this.stopDevServer();

    try {
      console.log('Building project for deployment...');
      const build = await container.spawn('npm', ['run', 'build']);

      let output = '';
      const outputDone = build.output.pipeTo(
        new WritableStream({
          write: (chunk) => {
            output += chunk;
            const lines = chunk.split('\n').filter((l: string) => l.trim());
            for (const line of lines) {
              this.addToConsoleBuffer(line);
            }
          },
        })
      );

      // Wait for build with a 120-second timeout
      const BUILD_TIMEOUT_MS = 120_000;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(
          'Build timed out after 2 minutes. The project may be too complex to build in the browser.'
        )), BUILD_TIMEOUT_MS)
      );

      let exitCode: number;
      try {
        const result = await Promise.race([
          Promise.all([build.exit, outputDone.catch(() => {})]),
          timeoutPromise,
        ]);
        exitCode = result[0];
      } catch (e: any) {
        // Kill the build process on timeout
        try { build.kill(); } catch {}
        throw e;
      }

      if (exitCode !== 0) {
        const errorLines = output.split('\n').filter((l: string) => l.trim()).slice(-10).join('\n');
        console.error('Build failed (exit code', exitCode, '):', errorLines);
        throw new Error(`Build failed (exit code ${exitCode}):\n${errorLines}`);
      }

      console.log('Build succeeded, reading dist/ files...');

      // Read all files from dist/ recursively
      const distFiles: Record<string, string> = {};
      const readDir = async (dirPath: string, prefix: string = '') => {
        try {
          const entries = await container.fs.readdir(dirPath, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = `${dirPath}/${entry.name}`;
            const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

            if (entry.isDirectory()) {
              await readDir(fullPath, relativePath);
            } else if (entry.isFile()) {
              try {
                const content = await container.fs.readFile(fullPath, 'utf-8');
                distFiles[relativePath] = content;
              } catch {
                // Skip binary files that can't be read as utf-8
              }
            }
          }
        } catch {
          // Directory doesn't exist
        }
      };

      await readDir('dist');

      if (Object.keys(distFiles).length === 0) {
        throw new Error('Build produced no output files in dist/. Check your build configuration.');
      }

      console.log(`Build produced ${Object.keys(distFiles).length} files:`, Object.keys(distFiles));
      return distFiles;
    } finally {
      // Always restart the dev server after build (success or failure)
      console.log('Restarting dev server...');
      this.startDevServer().catch(err =>
        console.error('Failed to restart dev server after build:', err)
      );
    }
  }

  async getFileTree(): Promise<FileSystemTree> {
    const container = WebContainerManager.instance;
    if (!container) throw new Error('Container not initialized');

    // Recursively build file tree
    const buildTree = async (path: string = '.'): Promise<FileSystemTree> => {
      const tree: FileSystemTree = {};
      const entries = await container.fs.readdir(path, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path === '.' ? entry.name : `${path}/${entry.name}`;

        if (entry.isDirectory()) {
          tree[entry.name] = {
            directory: await buildTree(fullPath),
          };
        } else if (entry.isFile()) {
          const contents = await container.fs.readFile(fullPath, 'utf-8');
          tree[entry.name] = {
            file: {
              contents,
            },
          };
        }
      }

      return tree;
    };

    return await buildTree();
  }

  /**
   * Reset manager state. Note: bootPromise is intentionally preserved because
   * WebContainer.boot() can only be called once per page load. Clearing it
   * causes a fatal error on the second boot (e.g. React StrictMode re-mount).
   */
  static destroy(): void {
    // Don't clear instance, bootPromise, or devServerUrl — WebContainer only boots
    // once per page load and the dev server keeps running across re-mounts.
    // Preserving devServerUrl means the preview iframe can immediately show
    // the running dev server without waiting for a new server-ready event.
  }
}
