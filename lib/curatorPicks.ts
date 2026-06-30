// Shared client carries maxRetries=4 (above the SDK default of 2) so a transient
// overload/rate-limit blip doesn't take down the whole nightly run. The SDK
// backs off automatically on 408/409/429/5xx and connection errors.
import { anthropic } from "./anthropic";

export interface CuratorPick {
  id: string;
  reason: string;
}
export interface CuratorPicks {
  block: CuratorPick[];
  feature: CuratorPick[];
}

const MODEL = "claude-sonnet-4-6";
// 749 candidates → ~85 picks → ~6.4k output observed. 16k leaves comfortable
// headroom so the JSON never truncates mid-array.
const MAX_TOKENS = 16000;

// Structured-outputs schema. With output_config.format the API constrains
// generation to valid JSON matching this shape, so a free-text reason that
// happens to contain an unescaped quote, newline, or control character can no
// longer produce an unparseable blob — which is exactly what was crashing the
// nightly auto-feature run ("Curator returned invalid JSON"). Note the schema's
// own constraints (additionalProperties:false, required) are all that
// structured outputs supports — no min/maxLength.
const CURATOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    block: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { id: { type: "string" }, reason: { type: "string" } },
        required: ["id", "reason"],
      },
    },
    feature: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { id: { type: "string" }, reason: { type: "string" } },
        required: ["id", "reason"],
      },
    },
  },
  required: ["block", "feature"],
} as const;

/**
 * Run the curator model on a prepared prompt and return its block/feature
 * verdict. Hardened against the failure modes that silently featured nothing:
 *   - the output is constrained to CURATOR_SCHEMA via structured outputs, so the
 *     model can't emit JSON that fails to parse (the old free-text path crashed
 *     the whole run whenever a reason string broke JSON escaping)
 *   - transient API errors are retried by the SDK (maxRetries above)
 *   - a truncated (max_tokens) response throws a clear, actionable error
 *     instead of crashing later on a half-written JSON blob
 *   - parseCuratorJson still runs as a defensive fallback (fences/prose strip,
 *     missing/!array keys degrade to [])
 */
export async function runCurator(prompt: string): Promise<CuratorPicks> {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: { type: "json_schema", schema: CURATOR_SCHEMA } },
  });

  if (message.stop_reason === "max_tokens") {
    throw new Error(
      `Curator response hit the ${MAX_TOKENS}-token output cap and was truncated; raise MAX_TOKENS or trim the candidate list.`
    );
  }

  const text = message.content[0]?.type === "text" ? message.content[0].text : "";
  return parseCuratorJson(text);
}

export function parseCuratorJson(text: string): CuratorPicks {
  // The model sometimes wraps its JSON in a ```json … ``` fence; drop fences
  // then slice from the first { to the last } to ignore any stray prose.
  const unfenced = text.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Curator returned no JSON object: ${text.slice(0, 200)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    throw new Error(`Curator returned invalid JSON: ${unfenced.slice(start, start + 200)}`);
  }

  const obj = (parsed ?? {}) as Partial<CuratorPicks>;
  return {
    block: Array.isArray(obj.block) ? obj.block : [],
    feature: Array.isArray(obj.feature) ? obj.feature : [],
  };
}
