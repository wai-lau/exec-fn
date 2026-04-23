import parseDialogue from "../../util/parseDialogue";

export const WintermutantL4 = parseDialogue(`
wintermutant:l4:100-600

#100 Hey dude. It's me again.
>200 What's up?
>200 Hey, Winter.

#200 Kewl battle! Hey, I was lookin over some of the nodes you've been through and I found something funny. Whoever did the hackjob through Pharmhaus left something behind.
>300 Left what behind?

#300 Some kind of weird program. I couldn't get a look at it 'cause it disappeared before I could catch it.
>400 Where was it from?
>401 What did it do?

#400 I'm not sure. Maybe the same hacker that's been corrupting these nodes. I saw a link to something called Nightfall. I'll keep checking the logs and see if I can find anything else.
>500 Thanks a lot.
>500 You do that.

#401 Don't know, seemed to be a link. Something about Nightfall. It might be connected to whoever is corrupting these nodes. I'll keep lookin into it though.
>600 Thanks a lot.
>500 You do that.

#500 Of course. Always ready to help S.M.A.R.T. Catch you later.
>600 Later.
`);
