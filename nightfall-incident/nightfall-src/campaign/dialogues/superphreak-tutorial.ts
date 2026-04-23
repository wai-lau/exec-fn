import parseDialogue from "../../util/parseDialogue";

export const SuperphreakTutorial = parseDialogue(`
superphreak:tutorial:100-2300

#100 Welcome to your first databattle. Here your programs duke it out with the enemy progams for control of a node.
>2300 I already know this stuff.
>200 Tell me more.

#200 First you have to upload your programs. Start by clicking on this upload spot.

#300 Now click on this program to upload it.

#400 Now click on the next upload spot.

#500 Upload this program.

#600 Alright. Let's get this battle started.

#700 All of your programs move and execute commands first, and then all of the enemy programs get their chance.
>800 Next

#800 Click on this program to select it.

#900 The highlighted grid squares show how far this program can move. Before we move it, let's see what it can do. \\n Hack is a simple battle program with only one command. Click on the command to see what it does.

#1000 The red squares show you the range for this command. This program has to move next to an enemy program to attack, so let's move it first. \\n Click on Undo to cancel the command.

#1100 Now click on this square to move the program.

#1200 When a program moves through memory, it expands. Each square of a program is called a sector. \\n The max size shows how much a program will expand as it moves. When a program reaches its max size, it can still move but the older sectors will disappear.
>1300 Next

#1300 We're still out of range. Click this square to move the program again.

#1400 Okay, now that we're next to the program, let's use that attack command. \\n Click on the command button.

#1500 To execute an attack command, click on any sector of an enemy program that is within range. \\n Click here to execute this command.

#1600 Nice. Now let's move our other program. Click here to select it.

#1700 Good. Now click here to move it closer.

#1800 Slingshot is a ranged attack program. \\n I think we're in range now. Click on the command to activate it.

#1900 Good. Now click on the enemy program to execute the command.

#2000 Way to go. You just won your first databattle.
>2100 Next

#2100 Of course, most databattles won't be as easy as this one. You'll need to pick up more powerful programs from warez nodes on the internet. \\n Some advanced programs have more than one command. Special commands can be used to increase the power of your own programs or even change the grid.
>2200 Next

#2200 OK, those are the basics. Do you want me to go over it again? \\n When you get back to the netmap, you'll be on your own. Click on a node and see what you can find out there. Good luck!
>100 Repeat
>2300 Done
`);
