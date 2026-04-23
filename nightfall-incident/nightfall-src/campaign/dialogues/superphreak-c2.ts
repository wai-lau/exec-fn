import parseDialogue from "../../util/parseDialogue";

export const SuperphreakC2 = parseDialogue(`
superphreak:c2:100-900

#100 ~~~~ ~~~ ~~~~~~~ hold on ~~~~~ ~~~ ~~~~ ~~~~~~~ trying to connect ~~~ ~~~~~
>200 Superphreak?

#200 Yeah, I'm back. I see you got the access codes. I think I'll have time to upgrade your status and show you a new warez node before I get cut off again.
>300 So what's up?
>300 Why did you get cut off before?

#300 Someone's been screwing around with S.M.A.R.T. Some kind of corrupt program got loose in our network and I got cut off. For a second, I thought it was 12AM out here.
>400 12AM?
>400 What was going on?

#400 12AM = Midnight. That's what we call a total network blackout. No access for anybody. It happened once a while ago during the worldwide power crisis. You wouldn't believe how bad it got before the network came back online.
>500 Got it.

#500 Anyway, someone directly sabotaged S.M.A.R.T and it's crippling our agents. But it's not affecting you because we haven't put your info into the S.M.A.R.T system yet.
>600 Who's responsible for this?
>601 What can I do to help?

#600 I'm not sure yet. I'm going to keep looking into it, but with all of us popping in and out, I guess that leaves you as the only functional agent.
>700 I'm ready.
>700 Great.

#601 Well, all of our agents keep getting shut out of the network. I'm busy just trying to stay online, so you'll need to get to work.
>700 I'm ready.
>700 Do you have any more info?

#700 I ran a trace on the problem that led back to the Lucky Monkey Eastern Distribution Site. Someone must have sent the corrupt program from there.
>800 Okay.

#800 I guess you should see if you can pick up the local records. I'll get back to you when I can.
>900 Ready for security level upgrade.
`);
