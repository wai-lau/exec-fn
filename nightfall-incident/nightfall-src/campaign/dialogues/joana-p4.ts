import parseDialogue from "../../util/parseDialogue";

export const JoanaP4 = parseDialogue(`
joana:p4:100-500

#100 Agent. I'm glad I found you. We've got a big problem here.
>200 What is it?

#200 We've found an undocumented node rerouting data to our system core. A security breach at this level is completely unacceptable. What are you going to do about it?
>300 I'm a little busy right now.

#300 If you can bypass our security, we'll set up a link to the undocumented node for you. That should give you access to whoever is causing this chaos.
>400 Fine.

#400 Be warned, agent. The security measures in our core are particularly fierce. Good luck.
>500 Good luck to you too.
`);
