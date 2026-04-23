import parseDialogue from "../../util/parseDialogue";

export const SuperphreakF5 = parseDialogue(`
superphreak:f5:100-500

#100 ~~~~ ~~~ ~~~~~ ~ ~~~~~ ~~~~ Man, it's hard to stay connected. Nice work so far.
>200 Thanks.
>200 What did you find out?

#200 I used a neural net sequencer to cross-reference all the logs you've given me so far. I was able to trace the programs back to the node that originally spawned them onto the net.
>300 Any idea who's behind it?
>301 Where is it?

#300 Just suspicions for now, but I did find a central location, a new node. Not sure how it connects - maybe a backdoor software.
>400 What do I do?

#301 It's a new node, so I'm not sure how it connects - maybe some backdoor somewhere. Anyway, I don't know who it belongs to, but I'll keep looking.
>400 And me?

#400 You're doing an excellent job. Keep on hacking and tell me what you find. I'll load the new node on your netmap now. 
>500 Ready to receive net data.
`);
