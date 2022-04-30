import { JoinMinigame } from 'types';

// [2022.04.26-01.53.35:004][443]LogBrickadia: Aware (fa577b9e-f2be-493f-a30a-3789b02ba70b) joining Ruleset GLOBAL
const minigameJoinRegExp = /^(?<playerName>.+) \((?<id>\w{8}-\w{4}-\w{4}-\w{4}-\w{12})\) joining Ruleset (?<rulesetName>.+)$/;

const joinMinigameMatcher: any = plugin => {
  return {
    // listen for commands messages
    pattern(_line, logMatch) {
      // line is not generic console log
      if (!logMatch) return;

      const { generator, data } = logMatch.groups;
      // check if log is a world log
      if (generator !== 'LogBrickadia') return;

      // match the log to the map change finish pattern
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