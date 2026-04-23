import parseDialogue from "../../util/parseDialogue";

export const WintermutantL3 = parseDialogue(`
wintermutant:l3:100-600

#100 Hey dude. Sorry to interrupt an elite S.M.A.R.T agent like yourself. Is it okay if we chat for a sec?
>200 Umm... who are you?
>201 Sure thing.

#200 Oh, I'm sort of a hacker too. I mean I'd like to be one. I hope you don't mind that I've been checking out your radical runs. Taking care of the Dr. Donut problems?
>300 What Dr. Donut problems?
>301 Where did you hear about problems?

#201 Thanx. I noticed S.M.A.R.T was down but you seem to be doing fine. You must have some radical tricks up your sleeve. :) Here to take care of the Dr. Donut problems?
>300 What Dr. Donut problems?
>301 Where did you hear about problems?

#300 I guess that's way beneath your radar. Some hacker screwed around with their systems and now they're all buggy.
>400 Could you tell me where the node is?
>400 Give me the info about the node.

#301 Oh, I saw S.M.A.R.T had crashed and I decided to do some snooping. Yeah, they got hit by a recent hack and their systems are all buggy.
>400 Could you tell me where that is?
>400 Give me the info about the node.

#400 Sure, I'll send it to you right away. I know I've got it around here somewhere. Hang on a sec...
>500 I'm waiting.
>500 Take your time.

#500 Got it! I'm uploaindg the node onto your netmap for you. Kewl talkin to you. CUL8R.
>600 Ready to receive node data.
`);
