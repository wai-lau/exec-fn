import parseDialogue from "../../util/parseDialogue";

export const LeoInitial = parseDialogue(`
leo:initial:100-300

#100 Hey, you must be that new S.M.A.R.T agent I heard about. Welcome to Leo's shop.
>200 Hi.

#200 We only got the best in wares, but for an up-and-comer like yourself, maybe an ex-agent like me can give you a break. You want to do some business?
>300 Sure, show me what you got.
>0 No thanks.
`);
