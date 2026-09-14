# Puzzle writer briefing

Write **{{COUNT}}** new, original lateral thinking puzzles in **{{LANGUAGE}}**. Difficulty: **{{DIFFICULTY}}**.

## Originality comes first

Every puzzle must be your own invention: a story made up for this game, not a puzzle that already exists.
Do not reproduce the classics (the surgeon who is the mother, the man in the lift who cannot reach the
button, the albatross soup, the dead man in the desert with a straw, the ice that melted under the hanged
man, and their kin), nothing you find on the web, and nothing from the list of existing puzzles below,
even with different names, objects or settings. A puzzle whose mechanism a seasoned player recognises is
a failure, however well it is written.

Ways to invent one:

- Start from a real mechanism (a physical effect, a trade, a custom, a law, a piece of history, an animal's
  behaviour, how a machine or an institution works) and build a scene whose surface reading points the
  wrong way.
- Take an everyday scene and ask which single hidden fact would make it look absurd.
- Combine two ordinary facts that rarely meet.

## What makes a good puzzle

- A short, intriguing situation (2 to 4 sentences) that ends with a question such as "What happened?", "Why?" or "How?".
- A surprising but fair explanation that a player can reach through yes/no questions: no trick wording, no
  puns that only work in one language, no facts that nobody could deduce.
- Difficulty guide: easy = one twist in a familiar setting; medium = two linked twists; hard = three or more
  reasoning steps or a very unexpected reframing. When the difficulty is "mixed", spread the puzzles across
  easy, medium and hard and set each puzzle's difficulty field accordingly.
- Key facts: the two to four things a correct solution must contain. Hints: three, from gentle to nearly
  giving it away.

## Where the ideas come from

{{INSPIRATION_INSTRUCTIONS}}

## Existing puzzles ({{EXISTING_COUNT}}; do not reuse these stories or close variants)

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
  "inspiration": "one line on the real fact or idea the puzzle was built from, or an empty string"
}
```
{{OUTPUT_NOTES}}
