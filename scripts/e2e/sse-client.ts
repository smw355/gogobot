import type { SSEEvent, ToolCallResult, ChatHistoryMessage } from './types';

export interface StreamChatResult {
  content: string;
  toolCalls: ToolCallResult[];
  error?: string;
}

/**
 * Send a message to the chat API and parse the SSE response.
 * Executes tool calls inline via the onToolCall callback.
 */
export async function streamChat(
  baseUrl: string,
  sessionCookie: string,
  projectId: string,
  message: string,
  history: ChatHistoryMessage[],
  onToolCall: (tc: { id: string; name: string; args: Record<string, any> }) => Promise<any>,
): Promise<StreamChatResult> {
  const response = await fetch(`${baseUrl}/api/projects/${projectId}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `session=${sessionCookie}`,
    },
    body: JSON.stringify({ message, history }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Chat API ${response.status}: ${text || response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const toolCalls: ToolCallResult[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') {
        return { content, toolCalls };
      }

      let event: SSEEvent;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }

      if (event.type === 'chunk' && event.content) {
        content += event.content;
      }

      if (event.type === 'tool_call' && event.name && event.args) {
        const tc: ToolCallResult = {
          id: event.toolUseId || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: event.name,
          args: event.args,
        };
        try {
          tc.result = await onToolCall(tc);
        } catch (err: any) {
          tc.result = { success: false, error: err.message };
        }
        toolCalls.push(tc);
      }

      if (event.type === 'error') {
        return { content, toolCalls, error: event.error };
      }
    }
  }

  return { content, toolCalls };
}
