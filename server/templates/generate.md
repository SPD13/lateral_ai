# Puzzle writer briefing

Write **{{COUNT}}** new lateral thinking puzzles in **{{LANGUAGE}}**. Difficulty: **{{DIFFICULTY}}**.

## What makes a good puzzle

- A short, intriguing situation (2 to 4 sentences) that ends with a question such as "What happened?", "Why?" or "How?".
- A surprising but fair explanation that a player can reach through yes/no questions: no trick wording, no
  puns that only work in one language, no facts that nobody could deduce.
- Difficulty guide: easy = one twist in a familiar setting; medium = two linked twists; hard = three or more
  reasoning steps or a very unexpected reframing. When the difficulty is "mixed", spread the puzzles across
  easy, medium and hard and set each puzzle's difficulty field accordingly.
- Key facts: the two to four things a correct solution must contain. Hints: three, from gentle to nearly
  giving it away.

## Finding inspiration

You may use web search to look for inspiration: classic situation puzzles, folklore, true stories with a
surprising explanation, science or history anecdotes. Use what you find as a starting point only. The
situation and solution you write must be your own wording, not copied text, and the story must not be
one of the existing puzzles below, even with different names, objects or settings.

## Existing puzzles (do not reuse these stories or close variants)

{{EXISTING_PUZZLES}}

## Output format (required; the server parses this)

Reply with one JSON array and nothing else: no markdown fences, no text before or after. Each element:

```
{
  "id": "kebab-case-unique-id",
  "title": "Short title",
  "difficulty": "easy" | "medium" | "hard",
  "situation": "What the player sees",
  "solution": "The full explanation, 2 to 5 sentences",
  "keyFacts": ["fact a correct answer must include", "..."],
  "hints": ["gentle hint", "stronger hint", "almost gives it away"],
  "inspiration": "one line on where the idea came from, or an empty string"
}
```
