import parseDialogue from "../../util/parseDialogue";

export const KimoniInitial = parseDialogue(`
kimoni:initial:100-300

#100 Hmm, I didn't think you would make it this far. Only the best agents have the talent to reach my shop.
>200 Thanks.

#200 I deal exclusively in top-of-the-line software options for the serious agent. Of course, that kind of quality does not come cheaply. Are you sure you're ready to shop at this level?
>300 Show me what you've got.
>0 No thanks.
`);
