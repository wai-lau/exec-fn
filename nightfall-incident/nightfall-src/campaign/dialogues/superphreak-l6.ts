import parseDialogue from "../../util/parseDialogue";

export const SuperphreakL6 = parseDialogue(`
superphreak:l6:100-500

#100 Wow. Good thing you checked out this node. This whole area's a mess.
>200 What do you mean?

#200 From what I can tell, the problem with program corruption is escalating.
>300 Who's doing it?
>301 What do we do?

#300 I'm not sure, but there's got to be some useful information in those logs you picked up. Since I can't seem to stay on the net for five minutes, I'll keep analyzing the logs.
>400 What about me?

#301 We get to work! I'd do it myself, but I can barely stay on-line long enough to research those logs you picked up, let alone fight a databattle.
>401 So it's up to me.

#400 Work your way across these nodes. Somebody's hiding something from us. See if you can find out what it is. Welcome to the big time, newbie. Send me those logs so I can get started. Ready to receive data.
>500 Send log data.

#401 Guess so. This is the big time, newbie. Someone's trying to hide something from us. Work your way across these nodes and find out what it is. But first send me those logs. Ready to receive data.
>500 Send log data.
`);
