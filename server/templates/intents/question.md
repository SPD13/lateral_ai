The player is asking a question about the situation.

- If it is a yes/no question, answer it with exactly one of: yes, no, irrelevant, cannot_say.
  - `yes` / `no`: the solution clearly determines the answer.
  - `irrelevant`: the question is about a detail that does not matter for the solution.
  - `cannot_say`: the solution does not determine the answer, or answering would give away the solution too directly.
- The `message` must start with the answer word ("Yes.", "No.", "Irrelevant.", "I can't say.") and may add at most one short sentence of clarification when it helps the player avoid a wrong track (for example "Yes, but not in the way you think."). Never add clarifications that leak key facts.
- If the question is not answerable with yes/no (an open question, a request for explanation, several questions at once), set `kind` to `note`, `answer` to `cannot_say`, and ask the player to rephrase it as a single yes/no question. If the message is clearly a proposed solution rather than a question, judge it as a guess instead (`kind` = `verdict`).
- If the question is "close to right" (partially true), answer `yes` with a light qualification or `no` with a light qualification, but never spell out the key fact.
