import { NextRequest } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { verifySession } from '@/lib/auth/verify-session';
import { VertexAI, GenerativeModel } from '@google-cloud/vertexai';
import { toolDeclarations } from '@/lib/ai/tools';
import { getSystemPrompt } from '@/lib/ai/system-prompt';

export const dynamic = 'force-dynamic';

const PRIMARY_MODEL = 'gemini-3-pro-preview';
const FALLBACK_MODEL = 'gemini-2.5-pro';

// Gemini 3 Pro requires location "global"; older models use us-central1
const PRIMARY_LOCATION = 'global';
const FALLBACK_LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

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
    fallbackVertexAI = new VertexAI({ project: projectId, location: FALLBACK_LOCATION, googleAuthOptions });
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
          });

          const { primaryModel, fallbackModel } = getModels();
          const models = [
            { model: primaryModel, name: 'Gemini 3 Pro' },
            { model: fallbackModel, name: 'Gemini 2.5 Pro' },
          ];

          let lastError: any = null;
          let succeeded = false;

          for (const { model, name } of models) {
            try {
              console.log(`Trying ${name}...`);

              const chat = model.startChat({
                history: chatHistory,
                systemInstruction: systemPrompt,
              });

              // Build the user message to send
              const userMessage = message && typeof message === 'string' && message.trim()
                ? message
                : 'Continue with the next steps based on the tool results.';

              const result = await chat.sendMessageStream(userMessage);

              for await (const chunk of result.stream) {
                const candidate = chunk.candidates?.[0];
                if (!candidate?.content?.parts) continue;

                for (const part of candidate.content.parts) {
                  // Skip thinking/reasoning parts — don't show internal reasoning to users
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
                    // Generate a unique ID for tracking tool calls
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

              console.log(`${name} succeeded`);
              succeeded = true;
              break;
            } catch (modelError: any) {
              lastError = modelError;
              console.error(`${name} failed:`, modelError.message);

              if (!shouldFallback(modelError)) {
                throw modelError;
              }

              if (model === primaryModel) {
                const switchMsg = '*Switching to faster model...*\n\n';
                assistantContent += switchMsg;
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: 'chunk', content: switchMsg })}\n\n`
                  )
                );
              }
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
          console.error('Chat error:', error);

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
    console.error('Chat error:', error);
    return new Response('Internal error', { status: 500 });
  }
}
