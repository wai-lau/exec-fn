import parseDialogue from "../../util/parseDialogue";

export const MinervaInitial = parseDialogue(`
minerva:initial:100-300

#100 So, you passed the test in getting here, and I checked your trail - no one followed you. Well done.
>200 Hi.

#200 As I'm sure you know, I deal in some of the more - esoteric - software on the net. Karmic warez for the enlightened hacker. It may cost plenty, but what are credits, really, when you think about it? Are you ready for net nirvana?
>300 Show me what you've got.
>0 No thanks.
`);
