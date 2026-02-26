import { ChatMessage, SSEEvent } from './types';

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.NEXT_PUBLIC_BASE_URL || '';
  }

  async streamChat(
    message: string,
    history: ChatMessage[],
    projectId: string,
    idToken: string,
    onEvent: (event: SSEEvent) => void,
    currentFiles?: string[]
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/projects/${projectId}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        message,
        history,
        projectId,
        currentFiles,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is null');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE messages
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);

          if (data === '[DONE]') {
            return;
          }

          try {
            const event: SSEEvent = JSON.parse(data);
            onEvent(event);
          } catch (error) {
            console.error('Failed to parse SSE event:', data, error);
          }
        }
      }
    }
  }

  async saveSnapshot(projectId: string, files: any, idToken: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/projects/${projectId}/snapshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({ files }),
    });

    if (!response.ok) {
      throw new Error(`Failed to save snapshot: ${response.statusText}`);
    }
  }

  async loadSnapshot(projectId: string, idToken: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/projects/${projectId}/snapshot`, {
      headers: {
        'Authorization': `Bearer ${idToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Failed to load snapshot: ${response.statusText}`);
    }

    const data = await response.json();
    return data.files;
  }
}
