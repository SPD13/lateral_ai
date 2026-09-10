# Collector briefing: take more from a page already used

Go back to **one page you have used before** and take up to **{{COUNT}}** more puzzles from it: ones that
were not taken last time.

## The page

{{SOURCE_URL}}

## Already taken from this page (skip every one of these)

{{TAKEN_TITLES}}

## How to work

1. Fetch that page and read it. Do not search for another one, and do not use any other page: everything you
   return must come from this URL.
2. Skip the puzzles listed above, and skip anything close to the puzzles listed under **Puzzles already in
   the game**, even loosely.
3. Take the puzzles as they are written on the page: this is a collection task, not a writing task. Keep each
   situation's facts and each solution's explanation faithful to the source.
4. Rewrite only what the game needs:
   - `situation`: the puzzle as the player sees it, 2 to 4 sentences, ending with a question. Keep the
     source's facts; tidy the wording, spelling and punctuation.
   - `solution`: the explanation the source gives, in 2 to 5 sentences.
   - `keyFacts`: the two to four things a correct answer must contain.
   - `hints`: three of your own, from gentle to nearly giving it away.
   - `difficulty`: `easy` (one twist), `medium` (two linked twists), `hard` (three or more steps).
5. If the page has nothing left that is new, return an empty `puzzles` array and still report the source.

Do not invent puzzles. Everything you return must come from that page.

## Puzzles already in the game (skip anything close to these)

{{EXISTING_PUZZLES}}

## Output format (required; the server parses this)

Reply with one JSON object and nothing else: no markdown fences, no text before or after.

```
{
  "source": { "url": "{{SOURCE_URL}}", "title": "Page or site title" },
  "puzzles": [
    {
      "id": "kebab-case-unique-id",
      "title": "Short title",
      "difficulty": "easy" | "medium" | "hard",
      "situation": "What the player sees",
      "solution": "The full explanation, 2 to 5 sentences",
      "keyFacts": ["fact a correct answer must include", "..."],
      "hints": ["gentle hint", "stronger hint", "almost gives it away"]
    }
  ]
}
```
