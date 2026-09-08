/** Identity comes from reference sheets. Review language without inventing visuals. */
export const REFERENCE_LANGUAGE_RULE = "Use the exact character name for every mention, even when repetitive; never switch to he, she, him, her, his, they, them, or their. Attached character sheets define appearance and wardrobe. Do not repeat static appearance or clothing descriptions. Preserve observed actions involving clothing, such as fabric ripping, tearing, or being removed, using the character name (for example, Diego's shirt tears). Never invent a replacement outfit.";

export const VISIBLE_WRITING_RULE = 'Write shot prose like screenplay action: only concrete visible subjects, actions, and setting. Describe a crowd or a few people when visible; do not force named characters into a location or crowd shot. Do not write internal notes such as "no named leads required", focal counts, reference availability, or coverage checks in captions, requested visuals, required-shot descriptions, or generation prompts. Keep those facts in structured fields when needed. A location alone is a complete shot; do not invent people or actions to fill space. Return only the requested artifact, with no preamble, explanation, Markdown fences, or trailing commentary.';

export type ReferenceLanguageIssue = { kind: "pronoun" | "appearance" | "sensitive-wording"; text: string; message: string };
const clothing = "(?:shirt|t-shirt|blouse|jacket|coat|dress|trousers|pants|jeans|skirt|suit|outfit|clothing|clothes|top|hoodie|vest|shorts|boots)";
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Only remove bounded, static appositives. Never delete a whole action caption. */
export function referenceAwareCaption(text: string, names: string[]): string {
  let result = text;
  for (const name of names.filter(name => name.trim())) {
    const identity = escapeRegex(name.trim());
    result = result.replace(new RegExp(`\\b(${identity}),\\s*(?:wearing|dressed in|in)\\s+[^,.;!?]*\\b${clothing}\\b,\\s*`, "gi"), (match, canonical: string) => {
      // An appositive may itself contain the observed action; leave it for review.
      return /\b(rip\w*|tear\w*|torn|remov\w*|off|fall\w*|slip\w*)\b/i.test(match) ? match : `${canonical} `;
    });
    result = result.replace(new RegExp(`\\b(${identity}),\\s*(?:shirtless|bare-chested|barechested),\\s*`, "gi"), "$1 ");
  }
  return result.trim();
}

/** Flags are actionable review findings, not provider-filter synonym substitutions. */
export function checkReferenceLanguage(text: string, names: string[] = []): ReferenceLanguageIssue[] {
  const issues: ReferenceLanguageIssue[] = [];
  const add = (kind: ReferenceLanguageIssue["kind"], match: string, message: string) => {
    if (!issues.some(issue => issue.kind === kind && issue.text.toLowerCase() === match.toLowerCase())) issues.push({ kind, text: match, message });
  };
  for (const match of text.matchAll(/\b(?:he|she|him|her|his|hers|himself|herself|they|them|their|theirs|themselves)\b/gi)) {
    add("pronoun", match[0], `Replace “${match[0]}” with the exact character name; keep the action unchanged.`);
  }
  for (const match of text.matchAll(/\b(?:shirtless|bare-chested|barechested|topless)\b/gi)) {
    add("appearance", match[0], `Let the character sheet define appearance instead of “${match[0]}”. Retain any visible clothing action.`);
  }
  for (const match of text.matchAll(new RegExp(`\\b(?:wearing|dressed in|clad in|in (?:a|an|the))\\s+[^,.;!?\\n]{0,65}\\b${clothing}\\b`, "gi"))) {
    add("appearance", match[0], `Remove the static wardrobe description “${match[0]}”; use the character name and preserve the action.`);
  }
  for (const name of names.filter(name => name.trim())) {
    const pattern = new RegExp(`\\b${escapeRegex(name.trim())}(?:'s|’s)\\s+(?:hair|eyes|skin|face|body)\\s+(?:is|are|looks?)\\b[^.;!?\\n]*`, "gi");
    for (const match of text.matchAll(pattern)) add("appearance", match[0], "Let the attached character sheet define static appearance; keep visible action and expression.");
  }
  for (const match of text.matchAll(/\b(?:sexy|sensual|seductive|provocative|sultry|erotic)\b/gi)) {
    add("sensitive-wording", match[0], `Review “${match[0]}”: describe the requested visible action precisely without an unnecessary sensitive adjective.`);
  }
  return issues;
}

export function assertReferenceLanguage(text: string, names: string[] = []) {
  const issues = checkReferenceLanguage(text, names);
  if (issues.length) throw new Error(`Review prompt language before submission. ${issues.map(issue => issue.message).join(" ")}`);
}
