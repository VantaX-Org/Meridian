/**
 * Meridian LLM Proxy — Cloudflare Worker
 * 
 * Fronts Ollama Cloud for all customer Meridian deployments.
 * Customer VMs never hold the Ollama API key.
 * 
 * Architecture:
 * 1. Customer Meridian calls this proxy with their licence JWT
 * 2. Proxy validates JWT and checks rate limits per customer
 * 3. Proxy logs customer UUID and token counts only (never prompt text)
 * 4. Proxy swaps in OLLAMA_API_KEY from Wrangler secrets
 * 5. Proxy forwards request to ollama.com/v1
 * 
 * Security:
 * - Licence JWT validation (Meridian-HQ signed)
 * - Per-customer rate limits (100 req/hour default)
 * - No raw SAP data ever reaches this worker
 * - No prompt bodies logged
 * 
 * For WS4 from Meridian v3.0 spec §8.
 */

import { Router } from 'itty-router';
import { verify } from '@tsndr/cloudflare-worker-jwt';
import type { JWTPayload } from 'jose';

interface Env {
  OLLAMA_API_KEY: string;
  OLLAMA_BASE_URL: string;
  JWT_SECRET: string;
  RATE_LIMIT_PER_HOUR: string;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  window_start: number;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function getCustomerId(payload: JWTPayload): string {
  return payload.sub || payload.tenant_id || payload.customer_id || 'unknown';
}

function getRateLimitKey(customerId: string): string {
  return `rate_limit:${customerId}`;
}

function getUsageKey(customerId: string): string {
  return `usage:${customerId}`;
}

function isRateLimited(
  cache: KVNamespace | null,
  customerId: string,
  limit: number
): { allowed: boolean; remaining: number; reset_at: number } {
  const now = Date.now();
  const hourMs = 3600 * 1000;
  const windowStart = now - hourMs;
  const key = getRateLimitKey(customerId);
  
  // In-memory fallback if KV not available
  const entry: RateLimitEntry = { count: 1, window_start: now };
  
  if (cache) {
    const stored = cache.get(key, 'json') as RateLimitEntry | null;
    if (stored) {
      // Reset if window expired
      if (stored.window_start < windowStart) {
        entry.count = 1;
        entry.window_start = now;
      } else {
        entry.count = stored.count + 1;
        entry.window_start = stored.window_start;
      }
    }
    cache.put(key, JSON.stringify(entry), { expirationTtl: 3600 });
  } else {
    // In-memory tracking (per-worker, not distributed)
    if (_rateLimitCache.has(customerId)) {
      const cached = _rateLimitCache.get(customerId)!;
      if (cached.window_start < windowStart) {
        cached.count = 1;
        cached.window_start = now;
      } else {
        cached.count += 1;
      }
      entry.count = cached.count;
      entry.window_start = cached.window_start;
    } else {
      _rateLimitCache.set(customerId, entry);
    }
  }
  
  const resetAt = entry.window_start + hourMs;
  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    reset_at: resetAt,
  };
}

// In-memory rate limit cache (for when KV is not available)
const _rateLimitCache = new Map<string, RateLimitEntry>();

// ---------------------------------------------------------------------------
// OpenAI-compatible request forwarding
// ---------------------------------------------------------------------------

interface OpenAIRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  [key: string]: unknown;
}

async function forwardToOllama(
  request: OpenAIRequest,
  env: Env
): Promise<Response> {
  const { OLLAMA_API_KEY, OLLAMA_BASE_URL } = env;
  
  // Build the Ollama request
  const ollamaRequest = {
    model: request.model,
    messages: request.messages,
    stream: request.stream ?? false,
    options: {
      temperature: request.temperature ?? 0.1,
      num_predict: request.max_tokens ?? 8192,
    },
  };
  
  // Forward to Ollama Cloud
  const ollamaResponse = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OLLAMA_API_KEY}`,
    },
    body: JSON.stringify(ollamaRequest),
  });
  
  return ollamaResponse;
}

// ---------------------------------------------------------------------------
// Router setup
// ---------------------------------------------------------------------------

const router = Router();

// Health check — no auth required
router.get('/health', (request, env) => {
  return new Response(
    JSON.stringify({
      status: 'ok',
      proxy: 'meridian-llm-proxy',
      version: '1.0.0',
    }),
    { 
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    }
  );
});

// Main proxy endpoint — OpenAI-compatible /v1/chat/completions
router.post('/v1/chat/completions', async (request, env: Env, ctx: ExecutionContext) => {
  try {
    // 1. Extract JWT from Authorization header
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    
    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization token' }),
        { 
          headers: { 'Content-Type': 'application/json' },
          status: 401,
        }
      );
    }
    
    // 2. Validate JWT
    let payload: JWTPayload;
    try {
      payload = await verify(token, env.JWT_SECRET) as JWTPayload;
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { 
          headers: { 'Content-Type': 'application/json' },
          status: 401,
        }
      );
    }
    
    // 3. Check rate limits
    const customerId = getCustomerId(payload);
    const rateLimit = parseInt(env.RATE_LIMIT_PER_HOUR || '100', 10);
    const { allowed, remaining, reset_at } = isRateLimited(
      ctx.waitUntil ? undefined : null, // KV requires ctx.waitUntil
      customerId,
      rateLimit
    );
    
    // Add rate limit headers
    const headers = new Headers({
      'Content-Type': 'application/json',
      'X-RateLimit-Remaining': remaining.toString(),
      'X-RateLimit-Reset': Math.floor(reset_at / 1000).toString(),
      'X-Customer-ID': customerId,
    });
    
    if (!allowed) {
      return new Response(
        JSON.stringify({ 
          error: 'Rate limit exceeded',
          message: `Customer ${customerId} has exceeded ${rateLimit} requests/hour`,
        }),
        { 
          headers,
          status: 429,
        }
      );
    }
    
    // 4. Parse request body
    let openaiRequest: OpenAIRequest;
    try {
      openaiRequest = await request.json<OpenAIRequest>();
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Invalid request body' }),
        { 
          headers,
          status: 400,
        }
      );
    }
    
    // 5. Log usage (customer UUID and token counts only — never prompt bodies)
    const estimatedTokens = estimateTokens(openaiRequest.messages);
    logUsage(customerId, estimatedTokens, openaiRequest.model);
    
    // 6. Forward to Ollama Cloud
    const ollamaResponse = await forwardToOllama(openaiRequest, env);
    
    // 7. Stream or return response
    if (openaiRequest.stream) {
      // Stream response back to client
      return new Response(ollamaResponse.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'X-RateLimit-Remaining': remaining.toString(),
          'X-RateLimit-Reset': Math.floor(reset_at / 1000).toString(),
        },
      });
    }
    
    // Return non-streaming response
    const responseBody = await ollamaResponse.text();
    return new Response(responseBody, {
      headers,
      status: ollamaResponse.status,
    });
    
  } catch (err) {
    console.error('Proxy error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal proxy error' }),
      { 
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});

// OpenAI-compatible models endpoint
router.get('/v1/models', (request, env) => {
  return new Response(
    JSON.stringify({
      object: 'list',
      data: [
        {
          id: 'deepseek-v3.1:671b-cloud',
          object: 'model',
          created: 1700000000,
          owned_by: 'meridian',
        },
      ],
    }),
    { 
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    }
  );
});

// ---------------------------------------------------------------------------
// Token estimation (rough)
// ---------------------------------------------------------------------------

function estimateTokens(messages: Array<{ role: string; content: string }>): number {
  // Very rough estimation: ~4 chars per token for typical English text
  // This is for logging purposes only, not billing
  let total = 0;
  for (const msg of messages) {
    total += (msg.content?.length || 0) / 4;
  }
  return Math.ceil(total);
}

// ---------------------------------------------------------------------------
// Usage logging (customer UUID + token counts only)
// ---------------------------------------------------------------------------

interface UsageLog {
  customer_id: string;
  timestamp: string;
  tokens: number;
  model: string;
  request_count: number;
}

function logUsage(customerId: string, tokens: number, model: string): void {
  // In production, this would write to a D1 database or log to a metrics service
  // Only customer UUID and token counts are logged — never prompt content
  const log: UsageLog = {
    customer_id: customerId,
    timestamp: new Date().toISOString(),
    tokens,
    model,
    request_count: 1,
  };
  
  // Log to console in development (would go to metrics in production)
  console.log(`[usage] ${JSON.stringify(log)}`);
}

// ---------------------------------------------------------------------------
// Worker export
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    
    return router.handle(request, env, ctx);
  },
};