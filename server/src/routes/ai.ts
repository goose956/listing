import { Router } from 'express';
import OpenAI from 'openai';
import { analyzeItemPrompt, listingGenerationPrompt } from '../services/prompts.js';
import { getSupabaseAdmin, isSupabaseAdminConfigured } from '../lib/supabaseAdmin.js';
import { createImageCollage } from '../lib/imageCollage.js';

export const aiRouter = Router();

/** Resolve the user id from a Supabase JWT via the service role. */
async function resolveUserId(authHeader?: string): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length);
  if (!token || !isSupabaseAdminConfigured()) return null;

  try {
    const {
      data: { user },
      error,
    } = await getSupabaseAdmin().auth.getUser(token);
    if (error || !user) return null;
    return user.id;
  } catch {
    return null;
  }
}

/** Get a user's stored OpenAI key, falling back to the server env key. */
async function resolveOpenAIKey(userId: string | null): Promise<string | null> {
  if (userId && isSupabaseAdminConfigured()) {
    try {
      const { data } = await getSupabaseAdmin()
        .from('user_settings')
        .select('openai_api_key')
        .eq('user_id', userId)
        .maybeSingle();
      if (data?.openai_api_key) return String(data.openai_api_key);
    } catch {
      // fall through to env key
    }
  }
  return process.env.OPENAI_API_KEY || null;
}

function getOpenAI(apiKey: string) {
  return new OpenAI({ apiKey });
}

/**
 * Analyse product images and suggest item details.
 * Body: { imageUrls: string[], purchasePrice?: number }
 */
aiRouter.post('/analyse', async (req, res) => {
  try {
    const { imageUrls, purchasePrice } = req.body as {
      imageUrls: string[];
      purchasePrice?: number;
    };

    if (!imageUrls?.length) {
      return res.status(400).json({ error: 'At least one image URL is required' });
    }

    // Determine which API key to use
    const userId = await resolveUserId(req.headers.authorization);
    const apiKey = await resolveOpenAIKey(userId);
    if (!apiKey) {
      return res.status(400).json({
        error:
          'No OpenAI API key configured. Add one in Settings, or set OPENAI_API_KEY in server/.env.',
      });
    }

    // Combine all images into a single collage to reduce API token usage
    const urls = imageUrls.slice(0, 4);
    const openai = getOpenAI(apiKey);

    const collageUri = await createImageCollage(urls, { thumbSize: 512 });

    const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      { type: 'text', text: analyzeItemPrompt(purchasePrice) },
      {
        type: 'image_url' as const,
        image_url: { url: collageUri, detail: 'low' as const },
      },
    ];

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'user', content }],
      max_tokens: 1000,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const raw = response.choices[0]?.message?.content || '{}';
    let analysis: Record<string, unknown>;
    try {
      analysis = JSON.parse(raw);
    } catch {
      analysis = { raw, error: 'Failed to parse AI response' };
    }

    res.json({ analysis, model: response.model });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI analysis failed';
    console.error('AI analyse error:', message);
    res.status(500).json({ error: message });
  }
});

/**
 * Generate Vinted listing content from item details.
 * Body: item fields + optional imageUrls
 */
aiRouter.post('/listing', async (req, res) => {
  try {
    const item = req.body as {
      brand?: string;
      product_type?: string;
      category?: string;
      size?: string;
      colour?: string;
      condition?: string;
      purchase_price?: number;
      suggested_price?: number;
      measurements?: string;
      notes?: string;
      imageUrls?: string[];
    };

    const userId = await resolveUserId(req.headers.authorization);
    const apiKey = await resolveOpenAIKey(userId);
    if (!apiKey) {
      return res.status(400).json({
        error:
          'No OpenAI API key configured. Add one in Settings, or set OPENAI_API_KEY in server/.env.',
      });
    }

    const openai = getOpenAI(apiKey);

    const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      { type: 'text', text: listingGenerationPrompt(item) },
    ];

    if (item.imageUrls?.length) {
      // Combine all provided images into one collage for the vision model
      const collageUri = await createImageCollage(item.imageUrls, { thumbSize: 512 });
      content.push({
        type: 'image_url' as const,
        image_url: { url: collageUri, detail: 'low' as const },
      });
    }

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'user', content }],
      max_tokens: 800,
      temperature: 0.5,
      response_format: { type: 'json_object' },
    });

    const raw = response.choices[0]?.message?.content || '{}';
    let listing: Record<string, unknown>;
    try {
      listing = JSON.parse(raw);
    } catch {
      listing = { raw, error: 'Failed to parse AI response' };
    }

    res.json({ listing, model: response.model });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Listing generation failed';
    console.error('AI listing error:', message);
    res.status(500).json({ error: message });
  }
});