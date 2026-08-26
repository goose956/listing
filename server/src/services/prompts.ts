export function analyzeItemPrompt(purchasePrice?: number): string {
  return `You are an expert second-hand fashion and goods appraiser for the UK Vinted marketplace.

Analyse the product photo(s) and return a JSON object with your best estimates.

Return ONLY valid JSON with these exact keys:
{
  "brand": "brand name or null if unknown",
  "product_type": "specific item type e.g. Wax Jacket, Running Trainers, Denim Jeans",
  "category": "one of: Women, Men, Kids, Home, Electronics, Entertainment, Hobbies, Other",
  "colour": "primary colour",
  "size": "size if visible on labels/tags, else null",
  "condition": "one of: new_with_tags, new_without_tags, very_good, good, satisfactory, fair",
  "condition_notes": "honest brief notes about visible wear, stains, damage",
  "suggested_price": number in GBP (realistic Vinted resale price),
  "accept_offers_above": number in GBP (minimum you'd accept),
  "confidence": number 0-1 how confident you are overall,
  "tags": ["array", "of", "search", "keywords"],
  "measurements_visible": "any measurements visible or null",
  "notes": "anything else useful for the seller"
}

Rules:
- Be honest about condition. Do not hide damage.
- Price for the UK Vinted market in 2024-2026.
- If brand is unclear, say null rather than guess wildly.
- suggested_price should be what you'd list at; accept_offers_above ~70-80% of that.
${purchasePrice != null ? `- Purchase price was £${purchasePrice}. Factor this into pricing advice.` : ''}
- tags should be terms buyers actually search (brand, type, colour, style).`;
}

export function priceCheckPrompt(input: {
  barcode?: string | null;
  purchasePrice?: number | null;
  userNotes?: string | null;
}): string {
  return `You are an expert UK retail and resale price checker for second-hand sellers.

Your job is to inspect the product photo(s) and any barcode hint, then return the most useful pricing guidance possible.

Return ONLY valid JSON with these exact keys:
{
  "barcode": "barcode string or null",
  "product_name": "specific product name if identifiable, otherwise null",
  "brand": "brand name or null",
  "product_type": "specific type such as Wax Jacket, Running Trainers, Coffee Machine",
  "category": "one of: Women, Men, Kids, Home, Electronics, Entertainment, Hobbies, Other",
  "model_number": "model, SKU, style code, ISBN or similar if visible, else null",
  "colour": "main colour or null",
  "size": "size if visible, else null",
  "condition_summary": "brief honest note on visible condition",
  "pricing_basis": "one of: barcode_match, visual_match, brand_model_match, category_estimate",
  "estimated_retail_price": number in GBP or null,
  "estimated_resale_listing_low": number in GBP or null,
  "estimated_resale_listing_high": number in GBP or null,
  "estimated_sold_price_low": number in GBP or null,
  "estimated_sold_price_high": number in GBP or null,
  "recommended_max_buy_price": number in GBP or null,
  "confidence": number from 0 to 1,
  "summary": "2-4 short sentences explaining what it likely is and the pricing view",
  "evidence": ["short bullet facts behind the estimate"],
  "search_keywords": ["useful", "keywords", "for", "sold", "comps"],
  "disclaimer": "brief warning when identification is uncertain"
}

Rules:
- Prioritise exact visible evidence: barcode, brand label, model code, packaging text, recognizable design details.
- If the exact product is unclear, say so and widen the range rather than pretending certainty.
- Prices must be realistic for the UK market in 2024-2026.
- Retail price means likely original or current new-shop price.
- Resale listing range means what similar items may be listed for second-hand.
- Sold price range means likely achieved second-hand sold prices, usually lower than listing price.
- recommended_max_buy_price should leave room for fees, offers, and profit. If confidence is low, keep it conservative.
- If barcode is provided but you cannot verify the exact product from the images, do not invent a precise match.
- Use GBP only.
${input.barcode ? `- Barcode hint: ${input.barcode}` : '- No barcode hint was provided.'}
${input.purchasePrice != null ? `- The user may be considering or has paid £${input.purchasePrice}. Use this when judging whether the buy is sensible.` : ''}
${input.userNotes ? `- User notes: ${input.userNotes}` : ''}`;
}

export function listingGenerationPrompt(item: {
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
}): string {
  const conditionLabels: Record<string, string> = {
    new_with_tags: 'New with tags',
    new_without_tags: 'New without tags',
    very_good: 'Very good',
    good: 'Good',
    satisfactory: 'Satisfactory',
    fair: 'Fair',
  };

  const conditionLabel = item.condition
    ? conditionLabels[item.condition] || item.condition
    : 'unknown';

  return `You are writing a Vinted listing for a UK second-hand seller. Natural, honest, search-friendly.

Item details:
- Brand: ${item.brand || 'Unknown'}
- Type: ${item.product_type || 'Unknown'}
- Category: ${item.category || 'Unknown'}
- Size: ${item.size || 'Not specified'}
- Colour: ${item.colour || 'Not specified'}
- Condition: ${conditionLabel}
- Suggested price: ${item.suggested_price != null ? `£${item.suggested_price}` : 'not set'}
- Purchase price: ${item.purchase_price != null ? `£${item.purchase_price}` : 'not set'}
- Measurements: ${item.measurements || 'none'}
- Notes: ${item.notes || 'none'}

Return ONLY valid JSON:
{
  "title": "max ~80 chars, brand + type + colour + size, keyword rich",
  "description": "2-5 short paragraphs. Natural seller tone. Honest condition. Mention measurements if available. No emoji spam. No fake urgency.",
  "list_price": number,
  "accept_offers_above": number,
  "tags": ["up to 8 search tags"],
  "price_rationale": "one sentence why this price"
}

Rules:
- Title example style: "Barbour Men's Wax Jacket Olive Green Size Medium"
- Description: honest second-hand seller, not marketing copy
- Do not claim item is new unless condition says so
- list_price in whole GBP pounds
- Include size and brand in title when known`;
}
