import React from "react";

import "./GameCredits.css";

const leftText = `
Original Gamelab Game (2002)/

_Code/
P e t er     L ee


__Game Design/
  Nick   For t u gno
  Fr an k  Lantz
    Eric     Zim m er man


_Graphics/
  Frank    L ant z
J u nk o  Ot su k i

______Process/
    Frank       Lantz


__Audio/
Mi cheal  Swee t _   A u d i  o b   r ai n


_QA
J ess ica            H amm er


_Lego.com/
 Tom a s   Clar k
V ina y            Tal ley
`;

const rightText = `
Remake (2020)/

_Code/
Pa tr i c k    P an

_Spritesheet/
S lee py   H arr   y

__Fonts/
Bi t L i ght  - S ar u
JH Ti tl e s  - Joi r o  H it ag a ya
0 4b2 5   - Yu  ji O shi moto

___Let's Play (YouTube)/
Em p  ire 8  74
`;

const GameCredits = () => (
  <div className="game-credits">
    <pre className="game-credits-left">{leftText}</pre>
    <pre className="game-credits-right">{rightText}</pre>
  </div>
);

export default GameCredits;
