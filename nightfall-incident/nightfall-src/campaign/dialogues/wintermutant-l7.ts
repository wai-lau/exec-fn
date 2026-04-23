import parseDialogue from "../../util/parseDialogue";

export const WintermutantL7 = parseDialogue(`
wintermutant:l7:100-600

#100 Wow, you're level 4! That's radical!! I knew you'd make it!
>200 Thanks, Winter.
>200 What's up? 

#200 I found something big! I finished my nightfall search and I found another secret stash!
>300 What did you find?
>301 Where is it?

#300 Some kind of accesss codes for a really tight private security set-up. It's hidden away in the Pharmhaus proprietary research node. Nasty defense software.
>400 Okay.

#301 It's tucked into the Pharmhaus proprietary research node. Nasty defence software. Anyway, it's some kind of acess codes for a really tight private security get-up.

#400 I'm putting the node on your map now. I tried to get them myself, but I got rejected before I could boot up. It's defintely Nightfall though.
>500 Great work, winter.
>500 I'll handle it from here.

#500 Thanx a lot. Kick butt! Go S.M.A.R.T!
>600 Ready to receive net data.
`);
