import parseDialogue from "../../util/parseDialogue";

export const JoanaF7 = parseDialogue(`
joana:f7:100-400

#100 Congratulations, agent. You've opened up our system. As you can observe, we've established a link to that mysterious node. There is a problem, however.
>200 What's wrong?

#200 The node has an unknown security level. We don't have the access codes to reach it. Without those codes, the node is inaccessible.
>300 Don't worry. I'll get the codes.

#300 We'll maintain the current link for you. Good luck and thank you, agent.
>400 You're welcome.
`);
