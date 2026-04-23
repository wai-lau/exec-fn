import * as Characters from "../campaign/characters";
import { IDialogueEntry, IDialogueButton, ICharacter, IDialogue } from "../types";

const charactersArray: ICharacter[] = Object.values(Characters);

function parseDialogue(text: string): IDialogue {
  const sections = text.split("\n\n");
  const [rawHeader, ...rawEntries] = sections;
  if (!rawHeader) {
    throw new Error("No header detected.");
  }
  const headerMatch = rawHeader.trim().match(/([\w\d\-\.]+):([\w\-]+)\:(\d+)-(\d+)/);
  if (!headerMatch) {
    throw new Error("Invalid header: " + rawHeader);
  }
  const characterID = headerMatch[1];
  const character = charactersArray.find((c) => c.id === characterID);
  if (!character) {
    throw new Error("Invalid character: " + characterID);
  }
  const id = headerMatch[2];
  const [startStage, endStage] = headerMatch.slice(3, 5).map(Number);

  const entries: IDialogueEntry[] = rawEntries.map((rawEntry) => {
    const lines = rawEntry.split("\n");
    const [rawText, ...rawButtons] = lines;
    if (!rawText) {
      throw new Error("No text detected for dialogue: " + rawEntry);
    }
    const textMatch = rawText.match(/#(\d+) (.+$)/);
    if (!textMatch) {
      throw new Error("Invalid dialogue text: " + rawText);
    }
    const stage = Number(textMatch[1]);
    const text = textMatch[2].replace(/( *)\\n( *)/g, "\u000A\u000A");
    const buttons: IDialogueButton[] = rawButtons
      .map((x) => x.trim())
      .filter((x) => x.length)
      .map((rawButton) => {
        const buttonMatch = rawButton.match(/>(\d+) (.+$)/);
        if (!buttonMatch) {
          throw new Error("Invalid dialogue button: " + rawButton);
        }
        const to = Number(buttonMatch[1]);
        const buttonText = buttonMatch[2];
        return {
          to,
          text: buttonText,
        };
      });

    return {
      stage,
      text,
      buttons,
    };
  });

  return {
    id,
    character,
    startStage,
    endStage,
    entries,
  };
}

export default parseDialogue;
