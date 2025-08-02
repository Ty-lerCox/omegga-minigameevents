import { JoinMinigame } from 'types';

/**
 * Matches checkpoint lines and emits a JoinMinigame object
 * via plugin.onMinigameJoin().
 *
 * Two identical log lines inside 100 ms are treated as duplicates.
 */
const minigameJoinRegExp =
  /^Ruleset (?<rulesetName>.+) (?:no saved checkpoint for player|loading saved checkpoint for player) (?<playerName>.+) \((?<id>\w{8}-\w{4}-\w{4}-\w{4}-\w{12})\)!*$/;

const joinMinigameMatcher = (plugin): any => {
  return {
    pattern(_line: string, logMatch: RegExpMatchArray | null) {
      if (!logMatch?.groups) return;

      const { generator, data, date } = logMatch.groups;
      if (generator !== 'LogBrickadia') return;

      const m = data.match(minigameJoinRegExp);
      if (!m?.groups) return;

      const [ymd, hms] = date.split('-');
      const utc = new Date(
        ymd.replace(/\./g, '-') + ':' + hms.replace(/\./g, ':')
      ).valueOf();

      /* de‑dupe spammy double‑checkpoint lines */
      if (plugin.joinTracker[data] && plugin.joinTracker[data] + 100 >= utc)
        return;
      plugin.joinTracker[data] = utc;

      /* periodic cleanup */
      if (Object.keys(plugin.joinTracker).length > 2000) {
        const cutoff = Date.now() - 60 * 60 * 1000;
        for (const k in plugin.joinTracker)
          if (plugin.joinTracker[k] < cutoff) delete plugin.joinTracker[k];
      }

      const jm: JoinMinigame = {
        player: { name: m.groups.playerName, id: m.groups.id },
        minigame: { name: m.groups.rulesetName, index: 0, ruleset: null },
      };
      return jm;
    },
    callback(jm: JoinMinigame) {
      if (jm) plugin.onMinigameJoin(jm);
    },
  };
};

export default joinMinigameMatcher;
