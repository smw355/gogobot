import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { verifySession } from '@/lib/auth/verify-session';
import { VertexAI, GenerativeModel } from '@google-cloud/vertexai';
import { toolDeclarations } from '@/lib/ai/tools';
import { getSystemPrompt } from '@/lib/ai/system-prompt';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 600; // 10 minutes — long Gemini inference + retries

const PRIMARY_MODEL = process.env.AI_PRIMARY_MODEL || 'gemini-3.1-pro-preview';
const FALLBACK_MODEL = process.env.AI_FALLBACK_MODEL || 'gemini-3-flash-preview';

// Both models use location "global"
const PRIMARY_LOCATION = process.env.AI_PRIMARY_LOCATION || 'global';
const FALLBACK_LOCATION = process.env.AI_FALLBACK_LOCATION || 'global';

// Lazy initialization to avoid build-time errors
let primaryVertexAI: VertexAI | null = null;
let fallbackVertexAI: VertexAI | null = null;
let primaryModel: GenerativeModel | null = null;
let fallbackModel: GenerativeModel | null = null;

function getModels() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID!;

  // Pass service account credentials to Vertex AI SDK
  const adminKey = process.env.FIREBASE_ADMIN_KEY;
  const googleAuthOptions = adminKey
    ? { credentials: JSON.parse(adminKey) }
    : undefined;

  if (!primaryVertexAI) {
    primaryVertexAI = new VertexAI({
      project: projectId,
      location: PRIMARY_LOCATION,
      apiEndpoint: 'aiplatform.googleapis.com',
      googleAuthOptions,
    });
  }
  if (!fallbackVertexAI) {
    fallbackVertexAI = new VertexAI({
      project: projectId,
      location: FALLBACK_LOCATION,
      apiEndpoint: 'aiplatform.googleapis.com',
      googleAuthOptions,
    });
  }

  if (!primaryModel) {
    primaryModel = primaryVertexAI.getGenerativeModel({
      model: PRIMARY_MODEL,
      tools: toolDeclarations,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 65536,
        // @ts-expect-error — thinkingConfig is supported by Gemini 3 but not yet in SDK types
        thinkingConfig: { thinkingBudget: 2048 },
      },
    });
  }

  if (!fallbackModel) {
    fallbackModel = fallbackVertexAI.getGenerativeModel({
      model: FALLBACK_MODEL,
      tools: toolDeclarations,
    });
  }

  return { primaryModel, fallbackModel };
}

function shouldFallback(error: any): boolean {
  const errorMessage = error?.message || String(error);
  return (
    errorMessage.includes('429') ||
    errorMessage.includes('RESOURCE_EXHAUSTED') ||
    errorMessage.includes('Too Many Requests') ||
    errorMessage.includes('quota') ||
    errorMessage.includes('404') ||
    errorMessage.includes('NOT_FOUND') ||
    errorMessage.includes('was not found') ||
    errorMessage.includes('overloaded')
  );
}

function isRateLimitError(error: any): boolean {
  const errorMessage = error?.message || String(error);
  return (
    errorMessage.includes('429') ||
    errorMessage.includes('RESOURCE_EXHAUSTED') ||
    errorMessage.includes('Too Many Requests') ||
    errorMessage.includes('quota')
  );
}

/**
 * Convert our internal message history to Gemini's expected format.
 * Gemini uses role 'model' (not 'assistant'), and uses functionCall/functionResponse parts.
 */
function convertHistoryToGemini(history: any[]): any[] {
  const geminiMessages: any[] = [];

  for (const msg of history) {
    if (msg.role === 'user') {
      if (msg.toolResults && Array.isArray(msg.toolResults)) {
        // Tool results → functionResponse parts
        geminiMessages.push({
          role: 'user',
          parts: msg.toolResults.map((tr: any) => ({
            functionResponse: {
              name: tr.name,
              response: tr.result || { success: true },
            },
          })),
        });
      } else if (typeof msg.content === 'string') {
        geminiMessages.push({
          role: 'user',
          parts: [{ text: msg.content || '' }],
        });
      } else if (Array.isArray(msg.content)) {
        // Claude-format tool_result blocks (backwards compat) → convert to functionResponse
        const parts = msg.content.map((block: any) => {
          if (block.type === 'tool_result') {
            let result;
            try {
              result = typeof block.content === 'string' ? JSON.parse(block.content) : block.content;
            } catch {
              result = { output: block.content };
            }
            return {
              functionResponse: {
                name: block.name || 'unknown',
                response: result || { success: true },
              },
            };
          }
          return { text: block.text || block.content || '' };
        });
        geminiMessages.push({ role: 'user', parts });
      }
    } else if (msg.role === 'assistant' || msg.role === 'model') {
      const parts: any[] = [];

      if (msg.content && typeof msg.content === 'string') {
        parts.push({ text: msg.content });
      }

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          parts.push({
            functionCall: {
              name: tc.name,
              args: tc.args,
            },
          });
        }
      }

      geminiMessages.push({
        role: 'model',
        parts: parts.length > 0 ? parts : [{ text: '' }],
      });
    }
  }

  return geminiMessages;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  try {
    const user = await verifySession();
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const db = getAdminDb();
    const projectDoc = await db.collection('projects').doc(projectId).get();

    if (!projectDoc.exists || projectDoc.data()?.userId !== user.uid) {
      return new Response('Not found', { status: 404 });
    }

    const { message, history, currentFiles } = await request.json();
    const project = projectDoc.data()!;

    // Fetch secret names (not values) so the AI knows what's available
    const secretsSnapshot = await db.collection('projects').doc(projectId).collection('secrets').get();
    const secretNames = secretsSnapshot.docs.map(d => d.id);

    // Fetch uploaded asset URLs so the AI can reference them
    const assetsSnapshot = await db.collection('projects').doc(projectId).collection('assets').get();
    const assetUrls = assetsSnapshot.docs.map(d => ({ name: d.id, url: d.data().url as string }));

    // Save user message to Firestore (only for real user messages, not continuations)
    if (message && typeof message === 'string' && message.trim()) {
      const messagesRef = db.collection('projects').doc(projectId).collection('messages');
      await messagesRef.add({
        role: 'user',
        content: message,
        timestamp: new Date(),
      });
    }

    // Create SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let assistantContent = '';

          const chatHistory = convertHistoryToGemini(history || []);
          const systemPrompt = getSystemPrompt(project.name || 'Untitled Project', {
            gcpProject: project.gcpProject || undefined,
            currentFiles: Array.isArray(currentFiles) ? currentFiles : undefined,
            secretNames: secretNames.length > 0 ? secretNames : undefined,
            assetUrls: assetUrls.length > 0 ? assetUrls : undefined,
            category: project.category || null,
          });

          const { primaryModel, fallbackModel } = getModels();

          // Build the user message to send
          const userMessage = message && typeof message === 'string' && message.trim()
            ? message
            : 'Continue with the next steps based on the tool results.';

          // Try primary model with retries (rate limits are transient), then fall back
          const MAX_RETRIES = 3;
          const RETRY_DELAYS = [5000, 15000, 30000]; // 5s, 15s, 30s backoff
          let succeeded = false;
          let lastError: any = null;

          // --- Attempt primary model with retries ---
          for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
              if (attempt > 0) {
                logger.info('Retrying primary model', { model: PRIMARY_MODEL, attempt, maxRetries: MAX_RETRIES, delayMs: RETRY_DELAYS[attempt - 1] });
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt - 1]));
              } else {
                logger.info('Trying primary model', { model: PRIMARY_MODEL });
              }

              const chat = primaryModel.startChat({
                history: chatHistory,
                systemInstruction: systemPrompt,
              });

              const result = await chat.sendMessageStream(userMessage);

              for await (const chunk of result.stream) {
                const candidate = chunk.candidates?.[0];
                if (!candidate?.content?.parts) continue;

                for (const part of candidate.content.parts) {
                  if ((part as any).thought) continue;

                  if (part.text) {
                    assistantContent += part.text;
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ type: 'chunk', content: part.text })}\n\n`
                      )
                    );
                  }

                  if (part.functionCall) {
                    const toolUseId = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({
                          type: 'tool_call',
                          toolUseId,
                          name: part.functionCall.name,
                          args: part.functionCall.args,
                        })}\n\n`
                      )
                    );
                  }
                }
              }

              logger.info('Primary model succeeded', { model: PRIMARY_MODEL, attempt });
              succeeded = true;
              break;
            } catch (modelError: any) {
              lastError = modelError;
              logger.error('Primary model attempt failed', { model: PRIMARY_MODEL, attempt, error: modelError.message });

              if (!isRateLimitError(modelError)) {
                // Non-rate-limit error — fall back immediately (don't retry 404s, etc.)
                if (shouldFallback(modelError)) break;
                throw modelError; // Unknown error — don't fall back
              }
              if (attempt === MAX_RETRIES) break; // Exhausted retries
            }
          }

          // --- Fallback to secondary model if primary failed ---
          if (!succeeded) {
            logger.warn('Primary model exhausted retries, falling back', { primary: PRIMARY_MODEL, fallback: FALLBACK_MODEL });
            try {
              const chat = fallbackModel.startChat({
                history: chatHistory,
                systemInstruction: systemPrompt,
              });

              const result = await chat.sendMessageStream(userMessage);

              for await (const chunk of result.stream) {
                const candidate = chunk.candidates?.[0];
                if (!candidate?.content?.parts) continue;

                for (const part of candidate.content.parts) {
                  if ((part as any).thought) continue;

                  if (part.text) {
                    assistantContent += part.text;
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ type: 'chunk', content: part.text })}\n\n`
                      )
                    );
                  }

                  if (part.functionCall) {
                    const toolUseId = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({
                          type: 'tool_call',
                          toolUseId,
                          name: part.functionCall.name,
                          args: part.functionCall.args,
                        })}\n\n`
                      )
                    );
                  }
                }
              }

              logger.info('Fallback model succeeded', { model: FALLBACK_MODEL });
              succeeded = true;
            } catch (fallbackError: any) {
              lastError = fallbackError;
              logger.error('Fallback model also failed', { model: FALLBACK_MODEL, error: fallbackError.message });
            }
          }

          if (!succeeded && lastError) {
            throw lastError;
          }

          // Save assistant message to Firestore
          if (assistantContent) {
            const messagesRef = db.collection('projects').doc(projectId).collection('messages');
            await messagesRef.add({
              role: 'assistant',
              content: assistantContent,
              timestamp: new Date(),
            });
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error: any) {
          logger.error('Chat streaming error', { error: error.message, projectId });

          if (isRateLimitError(error)) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'error',
                  error: 'The AI is currently busy. Please wait a moment and try again.',
                  retryable: true,
                  retryAfter: 30,
                })}\n\n`
              )
            );
          } else {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'error',
                  error: error.message || 'An error occurred',
                  retryable: false,
                })}\n\n`
              )
            );
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    logger.error('Chat route error', { error: error instanceof Error ? error.message : String(error) });
    return new Response('Internal error', { status: 500 });
  }
}
