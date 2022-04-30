import { OmeggaPlayer } from './omegga';

/** Created when a player joins a minigame */
export interface JoinMinigame {
  player: {
    name: string;
    id: string;
  }
  minigame: {
    name: string;
    index: number;
    ruleset: string;
    players: OmeggaPlayer[];
  }
}

export enum MinigameTypes {
  Global = "Global",
  Minigame = "Minigame",
  Default = "DefaultMinigame",
  Persistent = "PersistentMinigame"
}