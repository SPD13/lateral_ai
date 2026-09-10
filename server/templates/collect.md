# Collector briefing

Find **one web page you have not been given below** that publishes lateral thinking puzzles (also called
situation puzzles, yes/no puzzles or "minute mysteries"), then take up to **{{COUNT}}** puzzles from it.

## How to work

1. Use web search to look for pages that list such puzzles with their solutions. Vary the wording between
   runs so you do not land on the same few pages: try other phrasings, other languages' English pages,
   forums, teaching resources, quiz sites, blog posts, book excerpts.
2. Check your candidate page against **Sources already used** below. If it is there, search again for a
   different one. Never return a source from that list.
3. Fetch the page and read it. Take the puzzles as they are written there: this is a collection task, not a
   writing task. Keep each situation's facts and each solution's explanation faithful to the source.
4. Skip any puzzle on the page that matches something under **Puzzles already in the game**, even loosely.
5. Rewrite only what the game needs:
   - `situation`: the puzzle as the player sees it, 2 to 4 sentences, ending with a question. Keep the
     source's facts; tidy the wording, spelling and punctuation.
   - `solution`: the explanation the source gives, in 2 to 5 sentences.
   - `keyFacts`: the two to four things a correct answer must contain.
   - `hints`: three of your own, from gentle to nearly giving it away. Sources rarely provide these.
   - `difficulty`: `easy` (one twist), `medium` (two linked twists), `hard` (three or more steps).
6. If the page turns out to hold nothing usable, say so with an empty `puzzles` array and still report the
   source, so the next search skips it.

Do not invent puzzles. Everything you return must come from the page you report.

## Sources already used (never return one of these)

{{EXISTING_SOURCES}}

## Puzzles already in the game (skip anything close to these)

{{EXISTING_PUZZLES}}

## Output format (required; the server parses this)

Reply with one JSON object and nothing else: no markdown fences, no text before or after.

```
{
  "source": { "url": "https://the-page-you-used", "title": "Page or site title" },
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
