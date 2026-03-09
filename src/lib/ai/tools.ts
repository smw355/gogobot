// Tool declarations for Gemini function calling
// Development tools execute client-side in WebContainer
// GCP/infrastructure tools execute server-side via API

import { SchemaType, Tool } from '@google-cloud/vertexai';

export const toolDeclarations: Tool[] = [
  {
    functionDeclarations: [
      {
        name: 'writeFile',
        description:
          'Create or overwrite a file with the given content. Use for new files or when rewriting most of a file. For small edits to existing files, prefer patchFile instead.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            path: { type: SchemaType.STRING, description: 'File path relative to the project workspace' },
            content: { type: SchemaType.STRING, description: 'Complete content to write to the file' },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'patchFile',
        description:
          'Edit a specific section of an existing file by replacing old content with new content. More efficient and safer than rewriting the entire file. The oldContent must match exactly.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            path: { type: SchemaType.STRING, description: 'File path relative to the project workspace' },
            oldContent: {
              type: SchemaType.STRING,
              description: 'The exact text to find and replace (must match precisely, including whitespace)',
            },
            newContent: { type: SchemaType.STRING, description: 'The replacement text' },
          },
          required: ['path', 'oldContent', 'newContent'],
        },
      },
      {
        name: 'readFile',
        description: 'Read the contents of a file. Always read a file before modifying it to understand its current state.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            path: { type: SchemaType.STRING, description: 'File path relative to the project workspace' },
          },
          required: ['path'],
        },
      },
      {
        name: 'runCommand',
        description:
          'Execute a shell command in the project workspace. Use for npm scripts, build commands, etc. For installing packages, prefer installPackage instead.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            command: { type: SchemaType.STRING, description: 'Shell command to execute' },
          },
          required: ['command'],
        },
      },
      {
        name: 'listFiles',
        description:
          'List files and directories in the workspace. Use this first when starting work to understand the project structure.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            path: { type: SchemaType.STRING, description: 'Directory path relative to workspace (default: root)' },
          },
        },
      },
      {
        name: 'deleteFile',
        description: 'Delete a file from the workspace.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            path: { type: SchemaType.STRING, description: 'File path relative to the project workspace' },
          },
          required: ['path'],
        },
      },
      {
        name: 'searchFiles',
        description:
          'Search for text across files in the project. Returns matching file paths, line numbers, and content. Useful for finding where something is defined or used.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            pattern: { type: SchemaType.STRING, description: 'Text or pattern to search for' },
            path: { type: SchemaType.STRING, description: 'Directory to search in (default: entire project)' },
            filePattern: { type: SchemaType.STRING, description: 'File extension filter (e.g. ".tsx", ".css")' },
          },
          required: ['pattern'],
        },
      },
      {
        name: 'getErrors',
        description:
          'Get current errors from the dev server console. Call this after making file changes to catch build errors, compilation errors, and runtime warnings early.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {},
        },
      },
      {
        name: 'getConsoleOutput',
        description:
          'Get recent output from the dev server console. Shows build output, server logs, and runtime messages. Useful for debugging.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            lines: { type: SchemaType.NUMBER, description: 'Number of recent lines to return (default: 50)' },
          },
        },
      },
      {
        name: 'installPackage',
        description: 'Install an npm package. Handles error reporting and automatically updates package.json.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            packageName: {
              type: SchemaType.STRING,
              description: 'Package name with optional version (e.g. "react-router-dom" or "axios@^1.6")',
            },
            isDev: { type: SchemaType.BOOLEAN, description: 'Install as dev dependency (default: false)' },
          },
          required: ['packageName'],
        },
      },
      {
        name: 'deploy',
        description:
          'Deploy the current project to its own Firebase Hosting site on Google Cloud. Each project has its own isolated GCP project and hosting URL. Returns the live URL when successful.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            message: { type: SchemaType.STRING, description: 'Optional deployment message/notes' },
          },
        },
      },
      // --- GCP Infrastructure Tools (execute server-side) ---
      {
        name: 'getProjectInfo',
        description:
          'Get information about this project\'s cloud infrastructure: GCP project ID, hosting URL, enabled APIs, deployment status, and region. Call this to understand what infrastructure is available before suggesting actions.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {},
        },
      },
      {
        name: 'enableApi',
        description:
          'Enable a Google Cloud API for this project. Required before using certain cloud services. Common APIs: firestore.googleapis.com, run.googleapis.com, storage.googleapis.com, cloudfunctions.googleapis.com',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            apiName: {
              type: SchemaType.STRING,
              description: 'The API to enable (e.g. "run.googleapis.com", "firestore.googleapis.com")',
            },
          },
          required: ['apiName'],
        },
      },
      {
        name: 'viewLogs',
        description:
          'View recent logs from the project\'s cloud services via Cloud Logging API. Returns structured log entries with timestamps, severity, and messages. Use this to debug deployed applications — check for errors after a deploy, investigate runtime issues, or monitor Cloud Run/Cloud Functions behavior.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            severity: {
              type: SchemaType.STRING,
              description: 'Minimum severity filter: DEFAULT, DEBUG, INFO, WARNING, ERROR, CRITICAL (default: DEFAULT — returns all)',
            },
            resourceType: {
              type: SchemaType.STRING,
              description: 'GCP resource type to filter by (e.g. "cloud_run_revision", "cloud_function", "firebase_hosting_site"). Default: all resources.',
            },
            query: {
              type: SchemaType.STRING,
              description: 'Additional Cloud Logging filter query (e.g. "textPayload:\"error\"" or "httpRequest.status>=500"). Combined with other filters using AND.',
            },
            hours: {
              type: SchemaType.NUMBER,
              description: 'How many hours back to search (default: 1, max: 24)',
            },
            limit: {
              type: SchemaType.NUMBER,
              description: 'Max number of log entries to return (default: 50, max: 200)',
            },
          },
        },
      },
      {
        name: 'gcpRequest',
        description:
          'Make any Google Cloud REST API request within this project\'s GCP project. Use this for any GCP operation not covered by other tools: creating Cloud Run services, managing Cloud Storage buckets, calling Vertex AI, creating Firestore databases, managing Cloud Functions, and more. The URL MUST reference this project\'s GCP project ID (available from getProjectInfo). Authentication is handled automatically.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            url: {
              type: SchemaType.STRING,
              description:
                'Full Google Cloud REST API URL. Must be a *.googleapis.com URL containing this project\'s GCP project ID. Example: "https://run.googleapis.com/v2/projects/PROJECT_ID/locations/us-central1/services"',
            },
            method: {
              type: SchemaType.STRING,
              description: 'HTTP method: GET, POST, PUT, PATCH, or DELETE (default: GET)',
            },
            body: {
              type: SchemaType.STRING,
              description: 'JSON request body as a string. Required for POST/PUT/PATCH requests.',
            },
          },
          required: ['url'],
        },
      },
      // --- Secrets Tools (execute server-side) ---
      {
        name: 'getSecrets',
        description:
          'List the names of all secrets stored for this project. Returns names only, never values. Use this to check what API keys or credentials are available before building features that need them.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {},
        },
      },
      {
        name: 'getSecretValue',
        description:
          'Retrieve the actual value of a stored secret by name. Use this only when you need the value at runtime — for example, to configure a backend service or Cloud Run environment variable. For client-side code, use __ENV__{SECRET_NAME}__ placeholders instead, which get substituted at deploy time.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            name: {
              type: SchemaType.STRING,
              description: 'The secret name (e.g. "STRIPE_KEY", "OPENAI_API_KEY")',
            },
          },
          required: ['name'],
        },
      },
      // --- Assets Tools (execute server-side) ---
      {
        name: 'listAssets',
        description:
          'List all uploaded assets (images, logos, PDFs, fonts, etc.) for this project. Returns names and public URLs. Use these URLs directly in img src, CSS background-image, link href, etc. — they work in both preview and production.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {},
        },
      },
    ],
  },
];
