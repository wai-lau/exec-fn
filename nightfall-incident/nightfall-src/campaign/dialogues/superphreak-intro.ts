import parseDialogue from "../../util/parseDialogue";

export const SuperphreakIntro = parseDialogue(`
superphreak:intro:100-700

#100 Hey. Welcome to S.M.A.R.T. You must be the newbie I'm supposed to train.
>200 Newbie?
>200 Yeah.

#200 I hope you're a fast learner, cause I have more important things to do than to hold your hand all day.
>300 Go on.

#300 As a S.M.A.R.T agent, you're here to fix problems and battle infocrime. You can find out more at the S.M.A.R.T. HQ node.
>400 What's a node?
>400 I'll be sure to check that out.

#400 What you're looking at now is the netmap. It shows you all the network nodes and the connections between them.
>500 Go on.
>500 So what do I do with them?

#500 You can click on a node to set up a link to that computer. Once you're inside you'll need to databattle with that node's defensive programs. By the way, right now your security level is one, so you can only access level one nodes.
>600 Got it.

#600 Good. Time to get down to action. I'm going to walk you through your first databattle and give you some tips. Ready to get the party started?
>700 I'm ready!
>300 Wait. Can you go over all that again?
`);
