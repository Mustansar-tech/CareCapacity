function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(null));

  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + 1,
        );
      }
    }
  }
  return matrix[len1][len2];
}

function phonetic(name: string): string {
  if (!name) return "";

  let code = name.toUpperCase().replace(/[^A-Z]/g, "");
  if (!code) return "";

  let result = code[0];
  const mapping: Record<string, string> = {
    BFPV: "1",
    CGJKQSXZ: "2",
    DT: "3",
    L: "4",
    MN: "5",
    R: "6",
  };

  for (let i = 1; i < code.length; i++) {
    const char = code[i];
    let found = false;
    for (const [chars, num] of Object.entries(mapping)) {
      if (chars.includes(char)) {
        if (result[result.length - 1] !== num) {
          result += num;
        }
        found = true;
        break;
      }
    }
    if (!found && "AEIOUHYW".includes(char)) {
      // Skip vowels except at start
    }
  }

  return result.padEnd(4, "0").substring(0, 4);
}

export function getCloseMatches(
  target: string,
  choices: string[],
  cutoff: number = 0.7,
): Array<{ choice: string; score: number; confidence: number }> {
  if (!target) return [];

  const matches: Array<{ choice: string; score: number; confidence: number }> = [];
  const targetPhonetic = phonetic(target);

  for (const choice of choices) {
    if (!choice) continue;

    const targetTokens = new Set(target.split(" "));
    const choiceTokens = new Set(choice.split(" "));
    const intersection = new Set(
      Array.from(targetTokens).filter((x) => choiceTokens.has(x)),
    );
    const union = new Set([
      ...Array.from(targetTokens),
      ...Array.from(choiceTokens),
    ]);
    const tokenSimilarity = intersection.size / union.size;

    const maxLen = Math.max(target.length, choice.length);
    const editSimilarity =
      maxLen === 0 ? 1 : 1 - levenshteinDistance(target, choice) / maxLen;

    const choicePhonetic = phonetic(choice);
    const phoneticSimilarity = targetPhonetic === choicePhonetic ? 1 : 0;

    const combinedScore =
      tokenSimilarity * 0.4 + editSimilarity * 0.4 + phoneticSimilarity * 0.2;

    const methodScores = [tokenSimilarity, editSimilarity, phoneticSimilarity];
    const avgScore =
      methodScores.reduce((a, b) => a + b, 0) / methodScores.length;
    const variance =
      methodScores.reduce(
        (sum, score) => sum + Math.pow(score - avgScore, 2),
        0,
      ) / methodScores.length;
    const confidence = Math.max(0, 1 - Math.sqrt(variance));

    if (combinedScore >= cutoff) {
      matches.push({ choice, score: combinedScore, confidence });
    }
  }

  matches.sort((a, b) => b.score - a.score || b.confidence - a.confidence);
  return matches;
}
