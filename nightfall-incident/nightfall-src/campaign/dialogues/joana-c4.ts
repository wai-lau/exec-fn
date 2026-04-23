import parseDialogue from "../../util/parseDialogue";

export const JoanaC4 = parseDialogue(`
joana:c4:100-600

#100 Hello, agent. I supose I should thank you for assisting my company.
>200 All in a day's work.
>200 You're welcome.

#200 Good to see that S.M.A.R.T is fulfilling its professioal responsibilities. Along those lines, I have a task for you to perform.
>400 Sure. What's the task?
>300 What are you offering?

#300 An experimental piece of software, along with whatever credits you can find during the mission.
>402 What is the mission?

#400 The sysadmin archives have been locked down after an aborted crash attempt. It's going to take us a while to get it up and running, but we need a file from there yesterday.
>401 What do you need me to do?

#401 We need you to get that file. I have a backdoor route plotted out through a P.E.D. node. If you succeed, you get an experimental piece of software.
>500 Let me think about it.
>600 Alright, I'm game.

#402 Use a backdoor through the P.E.D. fiduciary node to access our sysadmin archives. The archives node locked down after an aborted crash attempt, and we need a file from there immediately.
>500 Let me think about it.
>500 Sure thing.

#500 I'm adding the archives node to your netmap. I'll contact you when you are in the vicinity of the node.
>600 Ready to receive net data.
`);
