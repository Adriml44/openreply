/**
 * Keyword Matcher
 *
 * Matches comment text against a set of keywords with support for:
 * - Case-insensitive matching
 * - Whole-word or partial matching
 * - Multi-keyword OR logic (any match = true)
 * - Emoji and special character stripping
 *
 * Unicode note: the original implementation used ASCII `\w` and `\b`, which
 * treat every Cyrillic / CJK / accented letter as a "special character" and a
 * non-word char. That silently deleted all non-Latin comment text before
 * matching, so a Russian keyword like "Клод" could never match. Everything
 * here uses Unicode property escapes (`\p{L}` letters, `\p{N}` numbers) with the
 * `u` flag so non-Latin scripts work.
 */

export interface KeywordMatchResult {
  matched: boolean;
  matchedKeyword: string | null;
}

/**
 * Strip emojis and special characters from text, keeping only
 * letters (any script), numbers, and whitespace.
 */
export function stripSpecialCharacters(text: string): string {
  return text
    .replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}]/gu,
      ""
    )
    // Keep letters (any script) and numbers; turn everything else into a space.
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check if a comment text matches any of the given keywords.
 *
 * @param commentText - The raw comment text to check
 * @param keywords - Array of keywords to match against
 * @param wholeWordMatch - If true, keyword must be a standalone word.
 *                         If false, partial matches are allowed (e.g. "linking" matches "link")
 * @returns Match result with the first matched keyword (if any)
 */
export function matchKeywords(
  commentText: string,
  keywords: string[],
  wholeWordMatch: boolean = true
): KeywordMatchResult {
  if (!commentText || keywords.length === 0) {
    return { matched: false, matchedKeyword: null };
  }

  const cleanedText = stripSpecialCharacters(commentText).toLowerCase();

  if (!cleanedText) {
    return { matched: false, matchedKeyword: null };
  }

  for (const keyword of keywords) {
    const cleanedKeyword = stripSpecialCharacters(keyword).toLowerCase();

    if (!cleanedKeyword) continue;

    if (wholeWordMatch) {
      const escapedKeyword = cleanedKeyword.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );
      // Unicode-aware "whole word": the keyword must not be flanked by another
      // letter or number. Lookarounds replace ASCII `\b`, which never fires
      // between two non-Latin characters.
      const regex = new RegExp(
        `(?<![\\p{L}\\p{N}])${escapedKeyword}(?![\\p{L}\\p{N}])`,
        "iu"
      );
      if (regex.test(cleanedText)) {
        return { matched: true, matchedKeyword: keyword };
      }
    } else {
      if (cleanedText.includes(cleanedKeyword)) {
        return { matched: true, matchedKeyword: keyword };
      }
    }
  }

  // Typos: «multiajentes», «mutliagente», «multi agentes»… Only long keywords
  // get this leeway, so short ones («IA», «EMAIL») never match by accident.
  const words = cleanedText.split(" ");
  const candidates = new Set(words);
  for (let i = 0; i + 1 < words.length; i++) candidates.add(words[i] + words[i + 1]);
  for (const keyword of keywords) {
    const k = stripSpecialCharacters(keyword).toLowerCase().replace(/ /g, "");
    const allowed = typoAllowance(k);
    if (allowed === 0) continue;
    for (const c of candidates) {
      if (Math.abs(c.length - k.length) <= allowed && editDistance(c, k) <= allowed) {
        return { matched: true, matchedKeyword: keyword };
      }
    }
  }

  return { matched: false, matchedKeyword: null };
}

/**
 * "Any post" campaigns listen on every post, so a keyword like «IA» or
 * «identidad» would otherwise fire on any sentence that happens to contain it
 * («se nota que es IA…»). People answering a call to action write the word and
 * little else, so those campaigns only consider short comments.
 */
export const ANY_POST_MAX_WORDS = 5;

export function wordCount(text: string): number {
  const cleaned = stripSpecialCharacters(text ?? "");
  return cleaned ? cleaned.split(" ").length : 0;
}

/** The comment-matching rule for a campaign (keywords, any word, any post). */
export function matchCampaignComment(
  commentText: string,
  campaign: { keywords: string[]; wholeWordMatch: boolean; matchAnyWord: boolean; matchAnyPost: boolean }
): KeywordMatchResult {
  if (campaign.matchAnyWord) return { matched: true, matchedKeyword: null };
  if (campaign.matchAnyPost && wordCount(commentText) > ANY_POST_MAX_WORDS) {
    return { matched: false, matchedKeyword: null };
  }
  return matchKeywords(commentText, campaign.keywords, campaign.wholeWordMatch);
}

/** How many typos a keyword tolerates: none under 8 letters, 1 for 8-9, 2 from 10. */
export function typoAllowance(keyword: string): number {
  const n = [...keyword].length;
  if (n >= 10) return 2;
  if (n >= 8) return 1;
  return 0;
}

/** Edit distance counting a swap of two neighbouring letters as one typo. */
export function editDistance(a: string, b: string): number {
  const s = [...a];
  const t = [...b];
  const d: number[][] = Array.from({ length: s.length + 1 }, (_, i) =>
    Array.from({ length: t.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[s.length][t.length];
}
