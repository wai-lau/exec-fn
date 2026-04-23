import parseDialogue from "../../util/parseDialogue";

export const SpinnerP2 = parseDialogue(`
spinner:p2:100-500

#100 Hey, Agent. You've been pretty hot lately. Looking for some extra work?
>200 I'm already on a couple of missions.
>201 What's the operation?

#200 For a hacker of your talent, this should be a breeze. All you have to do is rescue some files from a P.E.D. exec who stole them.
>300 Where's the node?
>301 What do I get out of this?

#201 A P.E.D. exec stole some precious files from a rival at Pharmhaus. We need you to retrieve them.
>300 Where's the node?
>301 What do I get out of this?

#300 That's the best part. You already have access to it. It's the P.E.D. re-insurance database you just opened. And if you succeed, Pharmhaus has a big credit bonus for you.
>400 Let me think about it.
>400 I'm in.

#301 Pharmhaus is offering a nice credit bonus as a reward. And the best part is, the node is the P.E.D. node that you just opened, the re-insurance database.
>400 Let me think about it.
>400 I'm in.

#400 You know where to go. I'll contact you when you're finished.
>500 Close
`);
