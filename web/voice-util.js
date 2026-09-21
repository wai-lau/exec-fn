// Shared voice helpers for the HosakaAudio-backed narrators (tarot-voice.js +
// exec-voice.js). The markdown-strip lives here so TTS reads prose (not
// asterisks / backticks) from one place instead of a copy per narrator.
(function () {
  "use strict";

  // Flatten markdown to spoken prose: what a voice should SAY, out of what a
  // renderer was told to draw. Drops code fences and spans, tables, list and
  // quote markers, rules, headings and emphasis; keeps a link's text.
  //
  // The line-level strips run first, while line starts still exist -- after the
  // final whitespace collapse there are no line starts left to anchor to.
  //
  // A TABLE is dropped whole rather than flattened. Read aloud, its pipes and
  // dashes are noise, and its cells are a grid whose meaning is the layout --
  // /cc answers with them routinely, and they are on the screen anyway.
  function stripMarkdown(md) {
    return (md || "")
      .replace(/```[\s\S]*?```/g, " ")                  // fenced code
      .replace(/^[ \t]*\|.*$/gm, " ")                    // table rows
      .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, " ")     // horizontal rules
      .replace(/^[ \t]*>[ \t]?/gm, "")                   // quote markers
      .replace(/^[ \t]*[-*+][ \t]+/gm, "")               // bullets
      .replace(/^[ \t]*\d{1,9}[.)][ \t]+/gm, "")         // ordered-list numbers
      .replace(/^#{1,6}\s*/gm, "")                       // headings
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      // Underscore emphasis ONLY when delimited by space or punctuation. The
      // bare /_([^_]+)_/ swallowed the middle of every snake_case identifier --
      // `dir_start_min` came out "dirstartmin", spoken as one long word, which
      // on /cc is most of a sentence about code.
      .replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s).,!?;:]|$)/g, "$1$2")
      .replace(/\[(.*?)\]\((.*?)\)/g, "$1")             // links: keep the text
      .replace(/\s+/g, " ")
      .trim();
  }

  window.VoiceUtil = { stripMarkdown };
})();
