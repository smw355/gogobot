export interface TestCase {
  name: string;
  prompt: string;
  complexity: 'simple' | 'medium' | 'complex' | 'full';
  needsBuild: boolean;
  expectedFiles: string[];
  verifyDeploy: (html: string) => boolean;
  timeoutMs: number;
}

export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  projectId?: string;
  deployUrl?: string;
  error?: string;
  iterations: number;
  toolCallCount: number;
}

export interface SSEEvent {
  type: 'chunk' | 'tool_call' | 'error' | 'status';
  content?: string;
  toolUseId?: string;
  name?: string;
  args?: Record<string, any>;
  error?: string;
  retryable?: boolean;
  retryAfter?: number;
}

export interface ToolCallResult {
  id: string;
  name: string;
  args: Record<string, any>;
  result?: any;
}

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content?: string;
  toolCalls?: { id: string; name: string; args: Record<string, any> }[];
  toolResults?: { name: string; result: any }[];
}
