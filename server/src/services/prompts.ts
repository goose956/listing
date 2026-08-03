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
