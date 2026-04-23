import parseDialogue from "../../util/parseDialogue";

export const SpinnerD4 = parseDialogue(`
spinner:d4:100-500

#100 Hey, pal. Got another job for you.
>200 What's the job?
>201 Who is it for?

#200 P.E.D. is reporting a malfunctioning sector in their privileged accounts node. Something there is destroying the surrouding memory units.
>300 Got it.

#201 It's P.E.D. – They always offer sweet credit rewards.
>301 Okay.

#300 Head there and clean up the problem queitly. P.E.D. will provide you with a privileged reward.
>400 Let me think about it.
>400 Sign me up.

#301 A memory unit in their privileged accounts node went bluescreen and needs to be shut down, quietly. Should be a walk in the park for someone with your ability.
>400 Let me think about it.
>400 Sign me up.

#400 I'll put the node up on your map. And between you and me, you may want to check the rest of the connecting nodes too. Things seem a little screwy. Ciao.
>500 Ready to receive net data.
`);
