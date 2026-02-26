import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { tmpdir } from 'os';

const SERVER_SIDE_TOOLS = ['getProjectInfo', 'enableApi', 'viewLogs', 'gcpRequest'];

export class LocalToolExecutor {
  public workDir: string;
  private files: Record<string, string> = {};
  private sessionCookie: string;
  private baseUrl: string;
  private projectId: string;
  private deployUrl: string | null = null;

  constructor(projectId: string, sessionCookie: string, baseUrl: string) {
    this.workDir = path.join(tmpdir(), `gogobot-e2e-${projectId}`);
    this.projectId = projectId;
    this.sessionCookie = sessionCookie;
    this.baseUrl = baseUrl;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.workDir, { recursive: true });
    // Write default files matching WebContainerManager.initialize()
    const defaultPkg = JSON.stringify({
      name: 'project',
      type: 'module',
      dependencies: {},
      devDependencies: { vite: '^5.0.0' },
      scripts: { dev: 'vite', build: 'vite build' },
    }, null, 2);
    const defaultHtml = `<!DOCTYPE html>
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
</html>`;
    await fs.writeFile(path.join(this.workDir, 'package.json'), defaultPkg);
    await fs.writeFile(path.join(this.workDir, 'index.html'), defaultHtml);
    this.files['package.json'] = defaultPkg;
    this.files['index.html'] = defaultHtml;
  }

  getDeployUrl(): string | null {
    return this.deployUrl;
  }

  getFiles(): Record<string, string> {
    return { ...this.files };
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.workDir, filePath));
      return true;
    } catch {
      return false;
    }
  }

  async execute(toolCall: { name: string; args: Record<string, any> }): Promise<any> {
    if (SERVER_SIDE_TOOLS.includes(toolCall.name)) {
      return this.executeServerSide(toolCall);
    }

    try {
      switch (toolCall.name) {
        case 'writeFile':
          return await this.writeFile(toolCall.args.path, toolCall.args.content);
        case 'patchFile':
          return await this.patchFile(toolCall.args.path, toolCall.args.oldContent, toolCall.args.newContent);
        case 'readFile':
          return await this.readFile(toolCall.args.path);
        case 'deleteFile':
          return await this.deleteFile(toolCall.args.path);
        case 'listFiles':
          return await this.listFiles(toolCall.args.path);
        case 'searchFiles':
          return await this.searchFiles(toolCall.args.pattern, toolCall.args.path, toolCall.args.filePattern);
        case 'runCommand':
          return await this.runCommand(toolCall.args.command);
        case 'installPackage':
          return await this.installPackage(toolCall.args.packageName, toolCall.args.isDev);
        case 'getErrors':
          return { success: true, errors: [], hasErrors: false };
        case 'getConsoleOutput':
          return { success: true, output: [], lines: 0 };
        case 'deploy':
          return await this.deploy();
        default:
          return { success: false, error: `Unknown tool: ${toolCall.name}` };
      }
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // --- File Operations ---

  private async writeFile(filePath: string, content: string) {
    const fullPath = path.join(this.workDir, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
    this.files[filePath] = content;
    return { success: true, message: `Created/updated file: ${filePath}` };
  }

  private async patchFile(filePath: string, oldContent: string, newContent: string) {
    const fullPath = path.join(this.workDir, filePath);
    const currentContent = await fs.readFile(fullPath, 'utf-8');
    if (!currentContent.includes(oldContent)) {
      const truncated = currentContent.length > 2000
        ? currentContent.slice(0, 2000) + '\n... (truncated)'
        : currentContent;
      return {
        success: false,
        error: `Could not find the specified text in ${filePath}. The file may have been modified. Use readFile to see the current content, or here it is:\n\n${truncated}`,
      };
    }
    const updatedContent = currentContent.replace(oldContent, newContent);
    await fs.writeFile(fullPath, updatedContent, 'utf-8');
    this.files[filePath] = updatedContent;
    return { success: true, message: `Patched file: ${filePath}` };
  }

  private async readFile(filePath: string) {
    const fullPath = path.join(this.workDir, filePath);
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      return { success: true, content, path: filePath };
    } catch {
      return { success: false, error: `File not found: ${filePath}` };
    }
  }

  private async deleteFile(filePath: string) {
    const fullPath = path.join(this.workDir, filePath);
    try {
      await fs.unlink(fullPath);
      delete this.files[filePath];
      return { success: true, message: `Deleted file: ${filePath}` };
    } catch {
      return { success: false, error: `Failed to delete: ${filePath}` };
    }
  }

  private async listFiles(dirPath?: string) {
    const fullPath = path.join(this.workDir, dirPath || '.');
    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const files = entries
        .filter(e => e.name !== 'node_modules' && !e.name.startsWith('.'))
        .map(e => e.isDirectory() ? `${e.name}/` : e.name);
      return { success: true, files, path: dirPath || '.' };
    } catch {
      return { success: false, error: `Directory not found: ${dirPath}` };
    }
  }

  private async searchFiles(pattern: string, dirPath?: string, filePattern?: string) {
    const results: Array<{ file: string; line: number; content: string }> = [];
    const searchDir = path.join(this.workDir, dirPath || '.');

    const walk = async (dir: string, prefix: string = '') => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
          const fullPath = path.join(dir, entry.name);
          const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

          if (entry.isDirectory()) {
            await walk(fullPath, relativePath);
          } else if (entry.isFile()) {
            if (filePattern && !relativePath.endsWith(filePattern)) continue;
            try {
              const content = await fs.readFile(fullPath, 'utf-8');
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].toLowerCase().includes(pattern.toLowerCase())) {
                  results.push({ file: relativePath, line: i + 1, content: lines[i].trim() });
                }
              }
            } catch { /* skip binary */ }
          }
        }
      } catch { /* skip inaccessible */ }
    };

    await walk(searchDir);
    return { success: true, matches: results.slice(0, 50), count: Math.min(results.length, 50) };
  }

  // --- Commands ---

  private runCommand(command: string): Promise<any> {
    return new Promise((resolve) => {
      exec(command, {
        cwd: this.workDir,
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, NODE_ENV: 'development' },
        shell: '/bin/bash',
      }, (error, stdout, stderr) => {
        const exitCode = error ? (error as any).code || 1 : 0;
        resolve({
          success: exitCode === 0,
          stdout: stdout.toString().slice(-5000),
          stderr: stderr.toString().slice(-5000),
          exitCode,
        });
      });
    });
  }

  private async installPackage(packageName: string, isDev?: boolean) {
    const cmd = isDev ? `npm install --save-dev ${packageName}` : `npm install ${packageName}`;
    const result = await this.runCommand(cmd);
    return {
      ...result,
      message: result.success ? `Installed ${packageName}` : `Failed to install ${packageName}`,
    };
  }

  // --- Deploy ---

  async deploy(): Promise<any> {
    let deployFiles: Record<string, string>;

    // Try building first
    try {
      // Check if there's a build script
      const pkgPath = path.join(this.workDir, 'package.json');
      const pkgContent = await fs.readFile(pkgPath, 'utf-8').catch(() => '{}');
      const pkg = JSON.parse(pkgContent);

      if (pkg.scripts?.build) {
        // Install deps first if node_modules doesn't exist
        try {
          await fs.access(path.join(this.workDir, 'node_modules'));
        } catch {
          console.log('    Installing dependencies...');
          const installResult = await this.runCommand('npm install');
          if (!installResult.success) {
            console.log('    npm install failed, trying deploy with source files...');
            throw new Error(installResult.stderr || 'npm install failed');
          }
        }

        console.log('    Running build...');
        const buildResult = await this.runCommand('npm run build');
        if (buildResult.success) {
          deployFiles = await this.readDistFiles();
          console.log(`    Build produced ${Object.keys(deployFiles).length} files`);
        } else {
          throw new Error(buildResult.stderr || 'Build failed');
        }
      } else {
        // No build script — deploy source files
        deployFiles = this.getSourceFiles();
      }
    } catch (buildErr: any) {
      // Fallback: check if source files are safe to deploy as-is
      const indexHtml = this.files['index.html'] || '';
      const hasUnbundledCode = /\.(jsx|tsx|ts)\b/.test(indexHtml);
      if (hasUnbundledCode) {
        return { success: false, error: `Build failed and source files contain unbundled code: ${buildErr.message}` };
      }
      console.log('    Build failed, deploying source files directly');
      deployFiles = this.getSourceFiles();
    }

    if (!deployFiles || Object.keys(deployFiles).length === 0) {
      return { success: false, error: 'No files to deploy' };
    }

    if (!deployFiles['index.html'] && !deployFiles['public/index.html']) {
      return { success: false, error: 'No index.html found' };
    }

    // POST to deploy API
    const response = await fetch(`${this.baseUrl}/api/projects/${this.projectId}/deploy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `session=${this.sessionCookie}`,
      },
      body: JSON.stringify({ files: deployFiles }),
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      return { success: false, error: result.error || 'Deployment failed' };
    }

    this.deployUrl = result.url;
    return { success: true, url: result.url, message: result.message };
  }

  private getSourceFiles(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [filePath, content] of Object.entries(this.files)) {
      // Skip non-deployable files
      if (filePath === 'package-lock.json') continue;
      if (filePath.startsWith('node_modules/')) continue;
      result[filePath] = content;
    }
    return result;
  }

  private async readDistFiles(): Promise<Record<string, string>> {
    const distDir = path.join(this.workDir, 'dist');
    const files: Record<string, string> = {};

    const walk = async (dir: string, prefix: string = '') => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(fullPath, relativePath);
        } else if (entry.isFile()) {
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            files[relativePath] = content;
          } catch { /* skip binary */ }
        }
      }
    };

    try {
      await walk(distDir);
    } catch {
      throw new Error('dist/ directory not found after build');
    }

    return files;
  }

  // --- Server-side tools ---

  private async executeServerSide(toolCall: { name: string; args: Record<string, any> }) {
    const response = await fetch(`${this.baseUrl}/api/projects/${this.projectId}/tools`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `session=${this.sessionCookie}`,
      },
      body: JSON.stringify({ tool: toolCall.name, args: toolCall.args }),
    });
    return response.json();
  }

  // --- Cleanup ---

  async cleanup(): Promise<void> {
    try {
      await fs.rm(this.workDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  }
}
