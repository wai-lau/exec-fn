import parseDialogue from "../../util/parseDialogue";

export const DisarrayP1 = parseDialogue(`
disarray:p1:100-400

#100 Hey. What are you doing here? Didn't I tell you I cleaned this area up already?
>200 Did you miss that last databattle?
>200 Well, there are still problems.

#200 Why don't you scram and let me take care of these nodes?
>300 Looks like you need some help.
>300 Superphreak told me to check it out.

#300 Hey, if you want, go ahead, keep hacking. You won't get very far before security kicks you back to level one. Contact me when you get stuck.
>400 Close.
`);
