export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
  result?: any;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  codeGenerated?: boolean;
  timestamp: Date;
  toolCalls?: ToolCall[];
}

export interface ChatMessage {
  role: string;
  content: string | ContentBlock[];
  toolCalls?: ToolCall[];
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, any>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
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
  status?: string;
}
