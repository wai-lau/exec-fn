import parseDialogue from "../../util/parseDialogue";

export const SpinnerF1 = parseDialogue(`
spinner:f1:100-600

#100 Hey pal. I see that you've been doing some sweet code slinging. Was wondering if you were interested in some extra business.
>300 What kind of business?
>200 Do you work for S.M.A.R.T?

#200 Not exactly. I'm more of a freelancer. Sometimes corporations get themselves into messes that need cleaning up. Their agents contact me and I contact individual S.M.A.R.T operatives to see if they're interested. What do you think?
>300 What's the job?

#300 A little side business in data policing. It turns out Pharmhaus was testing some new security and it went haywire. They can't even access their network.
>400 What do you need me to do?
>401 What do I get?

#400 They need someone quiet to access the node and disable the security. There's a top notch piece of software in it for you if you succeed. So, can I sign you on?
>500 Let me think about it.
>501 Sure, give me the info.

#401 Well, Pharmhaus is offering a nice shiny piece of software for someone to quietly acccess their node and disable the security system. What do you think?
>500 Let me think about it.
>501 Sure, give me the info.

#500 No problem. Take your time. I'll just put the node up on your netmap for yo uwhen you make up your mind. See you around.
>600 Ready to receive net data.

#501 Great! I knew you were the agent for the job. I'm putting the node up on your netmap now. I'll see you when you're done.
>600 Ready to receive net data.
`);
