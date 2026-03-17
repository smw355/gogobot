import { WebContainerManager } from '../webcontainer/manager';
import { ToolCall } from './types';

// Tools that execute server-side via API (need GCP credentials)
const SERVER_SIDE_TOOLS = ['getProjectInfo', 'enableApi', 'viewLogs', 'gcpRequest', 'getSecrets', 'getSecretValue', 'listAssets'];

export interface ToolExecutorOptions {
  projectId: string;
  getIdToken: () => Promise<string | undefined>;
  getFiles: () => Record<string, string>;
  onDeployStart?: () => void;
  onDeployComplete?: (result: { success: boolean; url?: string; error?: string }) => void;
}

export class ToolExecutor {
  private options?: ToolExecutorOptions;

  constructor(private container: WebContainerManager) {}

  setOptions(options: ToolExecutorOptions) {
    this.options = options;
  }

  async execute(toolCall: ToolCall): Promise<any> {
    try {
      // Route server-side tools to the API
      if (SERVER_SIDE_TOOLS.includes(toolCall.name)) {
        return this.executeServerSide(toolCall);
      }

      switch (toolCall.name) {
        case 'writeFile': {
          await this.container.writeFile(
            toolCall.args.path,
            toolCall.args.content
          );
          return {
            success: true,
            message: `Created/updated file: ${toolCall.args.path}`,
          };
        }

        case 'patchFile': {
          await this.container.patchFile(
            toolCall.args.path,
            toolCall.args.oldContent,
            toolCall.args.newContent
          );
          return {
            success: true,
            message: `Patched file: ${toolCall.args.path}`,
          };
        }

        case 'readFile': {
          const content = await this.container.readFile(toolCall.args.path);
          return {
            success: true,
            content,
            path: toolCall.args.path,
          };
        }

        case 'runCommand': {
          const result = await this.container.runCommand(toolCall.args.command);
          return {
            success: result.exitCode === 0,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
          };
        }

        case 'listFiles': {
          const files = await this.container.listFiles(toolCall.args.path || '.');
          return {
            success: true,
            files,
            path: toolCall.args.path || '.',
          };
        }

        case 'deleteFile': {
          await this.container.deleteFile(toolCall.args.path);
          return {
            success: true,
            message: `Deleted file: ${toolCall.args.path}`,
          };
        }

        case 'searchFiles': {
          const results = await this.container.searchFiles(
            toolCall.args.pattern,
            toolCall.args.path,
            toolCall.args.filePattern
          );
          return {
            success: true,
            matches: results,
            count: results.length,
          };
        }

        case 'getErrors': {
          const errors = this.container.getErrors();
          return {
            success: true,
            errors,
            hasErrors: errors.length > 0,
          };
        }

        case 'getConsoleOutput': {
          const output = this.container.getConsoleOutput(toolCall.args.lines);
          return {
            success: true,
            output,
            lines: output.length,
          };
        }

        case 'installPackage': {
          const pkg = toolCall.args.packageName;
          const isDev = toolCall.args.isDev || false;
          // --force bypasses platform checks (needed for Tailwind v4's @tailwindcss/oxide in WebContainers)
          const cmd = isDev ? `npm install --save-dev --force ${pkg}` : `npm install --force ${pkg}`;
          const installResult = await this.container.runCommand(cmd);
          return {
            success: installResult.exitCode === 0,
            stdout: installResult.stdout,
            stderr: installResult.stderr,
            exitCode: installResult.exitCode,
            message: installResult.exitCode === 0
              ? `Installed ${pkg}`
              : `Failed to install ${pkg}`,
          };
        }

        case 'deploy': {
          if (!this.options) {
            throw new Error('Tool executor not configured for deployment');
          }

          const { projectId, getIdToken, getFiles, onDeployStart, onDeployComplete } = this.options;

          onDeployStart?.();

          const idToken = await getIdToken();
          if (!idToken) {
            throw new Error('Authentication required to deploy');
          }

          // Read all files from the WebContainer filesystem for a complete deploy.
          // Falls back to tracked files if the filesystem read fails.
          let files: Record<string, string>;
          try {
            files = await this.container.getAllSourceFiles();
          } catch {
            files = getFiles();
          }
          if (!files || Object.keys(files).length === 0) {
            throw new Error('No files to deploy. Build something first!');
          }

          const response = await fetch(`/api/projects/${projectId}/deploy`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({ files }),
          });

          let deployResult;
          const responseText = await response.text();
          try {
            deployResult = JSON.parse(responseText);
          } catch {
            // Server returned non-JSON (e.g. "Service Unavailable" from Cloud Run)
            onDeployComplete?.({ success: false, error: `Deploy server error: ${responseText.slice(0, 200)}` });
            return {
              success: false,
              error: `Deploy failed — server returned: ${responseText.slice(0, 200)}. This usually means the build ran out of memory or time. Try again.`,
            };
          }

          if (!response.ok) {
            onDeployComplete?.({ success: false, error: deployResult.error });
            return {
              success: false,
              error: deployResult.error || 'Deployment failed',
            };
          }

          onDeployComplete?.({ success: true, url: deployResult.url });
          return {
            success: true,
            url: deployResult.url,
            message: deployResult.message,
          };
        }

        default:
          throw new Error(`Unknown tool: ${toolCall.name}`);
      }
    } catch (error: any) {
      // Ensure we always get a useful error string, even for non-Error objects
      const errorMsg = error instanceof Error
        ? error.message
        : (typeof error === 'string' ? error : JSON.stringify(error) || 'Tool execution failed');
      console.error(`Tool execution failed for ${toolCall.name}:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Execute a tool server-side via the tools API endpoint.
   */
  private async executeServerSide(toolCall: ToolCall): Promise<any> {
    if (!this.options) {
      throw new Error('Tool executor not configured');
    }

    const { projectId, getIdToken } = this.options;

    const idToken = await getIdToken();
    if (!idToken) {
      throw new Error('Authentication required');
    }

    const response = await fetch(`/api/projects/${projectId}/tools`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        tool: toolCall.name,
        args: toolCall.args,
      }),
    });

    let result;
    const text = await response.text();
    try {
      result = JSON.parse(text);
    } catch {
      return {
        success: false,
        error: `Server error (${response.status}): ${text.slice(0, 200)}`,
      };
    }

    if (!response.ok) {
      return {
        success: false,
        error: result.error || 'Server-side tool execution failed',
      };
    }

    return result;
  }
}
