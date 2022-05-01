import { JoinMinigame } from 'types';

// [2022.05.01-21.23.32:132][315]LogBrickadia: Ruleset GLOBAL no saved checkpoint for player Aware (fa577b9e-f2be-493f-a30a-3789b02ba70b)
// [2022.05.01-21.23.34:788][472]LogBrickadia: Ruleset Aware's Minigame loading saved checkpoint for player Aware (fa577b9e-f2be-493f-a30a-3789b02ba70b)!
const minigameJoinRegExp = /^Ruleset (?<rulesetName>.+) (no saved checkpoint for player|loading saved checkpoint for player) (?<playerName>.+) \((?<id>\w{8}-\w{4}-\w{4}-\w{4}-\w{12})\)!*$/;

const joinMinigameMatcher: any = plugin => {
  return {
    // listen for commands messages
    pattern(_line, logMatch) {
      // line is not generic console log
      if (!logMatch) return;

      const { generator, data } = logMatch.groups;
      // check if log is a brickadia log
      if (generator !== 'LogBrickadia') return;

      // match the log to the checkpoint pattern
      const matchJoin = data.match(minigameJoinRegExp);
      if (matchJoin?.groups?.rulesetName && matchJoin?.groups?.playerName && matchJoin?.groups?.id) {
        return {
          player: {
            name: matchJoin.groups.playerName,
            id:matchJoin.groups.id
          },
          minigame: {
            name: matchJoin.groups.rulesetName,
            index: 0,
            ruleset: null
          }
        };
      }

      return null;
    },
    // when there's a match, emit the comand event
    callback(joinMinigame: JoinMinigame) {
      console.log(joinMinigame)
      // if the only argument is an empty string, ignore it
      if (joinMinigame) {
        plugin.onMinigameJoin(joinMinigame)
      }
    },
  };
};

export default joinMinigameMatcher;