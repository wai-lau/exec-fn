// Shared voice helpers for the HosakaAudio-backed narrators (tarot-voice.js +
// exec-voice.js). The markdown-strip lives here so TTS reads prose (not
// asterisks / backticks) from one place instead of a copy per narrator.
(function () {
  "use strict";

  // Flatten markdown to spoken prose. Drops code fences/spans, bold/italic
  // markers, headings, and link syntax (keeps the link text).
  function stripMarkdown(md) {
    return (md || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  window.VoiceUtil = { stripMarkdown };
})();
