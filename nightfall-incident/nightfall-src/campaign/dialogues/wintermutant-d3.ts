import parseDialogue from "../../util/parseDialogue";

export const WintermutantD3 = parseDialogue(`
wintermutant:d3:100-600

#100 Hey partner! You really cleaned up those Dr. D nodes!
>200 Thanks, Winter.
>200 What's up?

#200 I went sneaking around there after you left. And guess what? I found more traces of that weird program.
>300 Any idea where it came from?
>301 Know what it's for yet?

#300 Totally! The traces had the same nightfall signature. So I did this special kind of search I made up, and I found something.
>400 What did you find?

#301 Nope. It's _really_ slippery, but I did get a clue about what Nightfall might be. I did this special kind of search I made up, and I found something.
>400 What did you find?

#400 A nice piece of software somebody made. IT's stashed away deep in sector 4 in a Lucky Monkey node, not that they know it's there of course.
>500 Where is the node?
>501 Did you find anything else?

#500 It'll be on your map in a sec, partner. Anyway, I'm gonna keep on searching for the Nightfall hacker and see what I find. C U
>600 Ready to receive node data.

#501 Not yet, but I'm gonna keep searching for the Nightfall hacker and see what else I find + I'll put the Moneky node up on your map. C U partner.
>600 Ready to receive node data.
`);
