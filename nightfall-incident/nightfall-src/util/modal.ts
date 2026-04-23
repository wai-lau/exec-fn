import { ModalConfig } from "../components/Modal";

export const createTurnModal = (teamName: string) => {
  const fmtTeamName = teamName === "P1" ? "Player" : "Enemy";
  return {
    headerBoxTitle: "phase.sequence",
    header: `${fmtTeamName} turn`,
    duration: 1000,
  } as ModalConfig;
};

export const createCreditsModal = (amount: number) => {
  return {
    headerBoxTitle: "credits.amt",
    header: `${amount} credits`,
    duration: 1000,
  } as ModalConfig;
};
