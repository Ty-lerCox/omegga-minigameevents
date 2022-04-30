# omegga-minigameevents

A set of events to help with minigame plugins

## Install

`omegga install gh:mrware/minigameevents`


## Types

| Types                          |                                                                  |
| ------------------------------ | -----------------------------------------------------------------|
| `Player`                       | { name: string, id: string, controller: string , state: string } |
| `Minigame`                     | { name: string, ruleset: string, index: number }                 |

## Events


| Method                         | Return Type                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `joinminigame`                 | { player: Player, minigame: Minigame}                                                                                                                                   |
| `leaveminigame`                | { player: Player, minigame: Minigame}                                                                                                                                   |
| `roundend`                     | Minigame                                                                                                                                                                |
| `roundchange`                  | Minigame                                                                                                                                                                |
| `leaderboardupdate`            | { player: Player, minigame: Minigame, leaderboard: [ score: number, kills: number, deaths: number ], oldLeaderboard: [ score: number, kills: number, deaths: number ] } |
| `kill`                         | { player: Player, minigame: Minigame, leaderboard: [ score: number, kills: number, deaths: number ], oldLeaderboard: [ score: number, kills: number, deaths: number ] } |
| `death`                        | { player: Player, minigame: Minigame, leaderboard: [ score: number, kills: number, deaths: number ], oldLeaderboard: [ score: number, kills: number, deaths: number ] } |
| `score`                        | { player: Player, minigame: Minigame, leaderboard: [ score: number, kills: number, deaths: number ], oldLeaderboard: [ score: number, kills: number, deaths: number ] } |

## Sample plugin

https://github.com/mraware/omegga-sample-minigameevents

