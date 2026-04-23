import parseDialogue from "../../util/parseDialogue";

export const DisarrayF4 = parseDialogue(`
disarray:f4:100-500

#100 Hello again.
>200 Oh, hey Disarray.

#200 Nice work on that last node. I was just coming to check it out myself. Guess the work here is done.
>300 What do you mean?

#300 What do I mean? I just took care of the rest of the nodes in this area. Everything's totally clean.
>400 Are you sure about that?
>401 So what should I do?

#400 Look, kid, I'm a _much_ better hacker than you are. If I tell you they're clean, they're clean. Check you later.
>500 See you around.

#401 Just stay out of my way, small fry. Check you later.
>500 See you around.
`);
