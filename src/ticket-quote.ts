// Memory-ticket helpers shared by the personal and hosted TongPing servers.

// One short, already-played line for the ticket; never a cue after cutoff.
export function pickTicketQuote(
  subtitles: unknown,
  cutoff: number | null,
): string | null {
  if (cutoff === null || !Array.isArray(subtitles)) return null;
  const played = subtitles
    .filter((cue: any) =>
      cue &&
      typeof cue.startTime === "number" &&
      cue.startTime <= cutoff &&
      typeof cue.text === "string",
    )
    .sort((a: any, b: any) => a.startTime - b.startTime);
  for (let index = played.length - 1; index >= 0; index -= 1) {
    const text = String((played[index] as any).text)
      .replace(/\s+/g, " ")
      .trim();
    if (text.length >= 2 && text.length <= 28) return text;
  }
  return null;
}

// Deterministic mood words from the Audio Vision summary; null when thin.
export function ticketMoodFromAudio(summary: any): string | null {
  if (!summary || typeof summary.energy !== "number") return null;
  const stateWord: Record<string, string> = {
    calm: "calm",
    steady: "steady",
    build: "building gradually",
    peak: "peak",
    release: "afterglow",
  };
  const words: string[] = [];
  if (typeof summary.state === "string" && stateWord[summary.state]) {
    words.push(stateWord[summary.state]!);
  }
  words.push(
    summary.energy < 0.3 ? "low energy" : summary.energy < 0.65 ? "medium energy" : "high energy",
  );
  if (typeof summary.rhythmicDensity === "number") {
    words.push(
      summary.rhythmicDensity < 1.5 ? "relaxed" : summary.rhythmicDensity < 4 ? "rhythmic" : "rhythmically dense",
    );
  }
  return words.length >= 2 ? words.join(" · ") : null;
}
