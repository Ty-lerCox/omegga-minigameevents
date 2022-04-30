import OmeggaPlugin, { OL, PS, PC, PluginInterop } from './omegga';
import joinMinigameMatcher from './matchers/joinMinigame';
import { JoinMinigame, MinigameTypes } from './types';

type Config = { minigameCheckInterval: number, leaderboardCheckInterval: number };
type Storage = { subscriberNames: string[], minigameCache: any, playerStateCache: any };

export default class Plugin implements OmeggaPlugin<Config, Storage> {
  omegga: OL;
  config: PC<Config>;
  store: PS<Storage>;
  subscribers: PluginInterop[];
  minigameCheckInterval: NodeJS.Timer;
  leaderboardCheckInterval: NodeJS.Timer;
  minigameCache: Map<string, any>;
  playerStateCache: Map<string, any>;

  constructor(omegga: OL, config: PC<Config>, store: PS<Storage>) {
    this.omegga = omegga;
    this.config = config;
    this.store = store;

    this.subscribers = [];
    this.minigameCache = new Map<string, any>();
    this.playerStateCache = new Map<string, any>();
  }

  async init() {

    const minigameCache = await this.store.get('minigameCache');
    this.minigameCache = minigameCache ? new Map(Object.entries(minigameCache)) : new Map<string, any>();
    const playerStateCache = await this.store.get('playerStateCache');
    this.playerStateCache = playerStateCache ? new Map(Object.entries(playerStateCache)) : new Map<string, any>();

    const subscriberNames = await this.store.get("subscriberNames") || [];
    for (const subscriberName of subscriberNames) {
      await this.subscribe(subscriberName);
    }
    this.minigameCheckInterval = setInterval(this.minigameCheck, this.config.minigameCheckInterval);
    this.leaderboardCheckInterval = setInterval(this.leaderboardCheck, this.config.leaderboardCheckInterval);
    const { pattern, callback } = joinMinigameMatcher(this);
    this.omegga.addMatcher(pattern, callback)

    this.omegga.on('join', this.onJoin);
    this.omegga.on('leave', this.onLeave);
    this.omegga.on('start', () => {
      this.minigameCache = new Map<string, any>();
      this.playerStateCache = new Map<string, any>();
    })
  }

  async stop() {
    clearInterval(this.minigameCheckInterval);
    clearInterval(this.leaderboardCheckInterval);

    await this.store.set('minigameCache', Object.fromEntries(this.minigameCache));
    await this.store.set('playerStateCache', Object.fromEntries(this.playerStateCache));
  }

  onJoin = async (player) => {
    const defaultMinigame = await this.getDefaultMinigame();
    const minigame = this.minigameCache.get(defaultMinigame?.ruleset);
    if (minigame) {
      this.onMinigameJoin({
        player: this.omegga.getPlayer(player.controller),
        minigame
      });
    } else {
      // Apparently this player joined before any minigames were cached or exactly when a minigame ended so lets just do this again later
      setTimeout(() => this.onJoin(player), 1000)
    }
  }

  onLeave = (player) => {
    this.onMinigameLeave(this.omegga.getPlayer(player), null);
  }

  subscribe = async (pluginName) => {
    if (!this.subscribers.find((subscriber) => subscriber.name === pluginName)) {
      const plugin = await this.omegga.getPlugin(pluginName);
      if (plugin && plugin.loaded) {
        this.subscribers.push(
          await this.omegga.getPlugin(pluginName)
        );
      } else {
        console.log(`${pluginName} is not loaded, removing subscription`)
      }
    }
    await this.store.set("subscriberNames", this.subscribers.map(subscriber => subscriber.name));
  }

  unsubscribe = async (pluginName) => {
    this.subscribers = this.subscribers.filter((subscriber) => !(subscriber.name === pluginName))
    await this.store.set("subscriberNames", this.subscribers.map(subscriber => subscriber.name));
  }

  onMinigameJoin = async (joinMinigame: JoinMinigame) => {
    const minigame = [...this.minigameCache.values()].find((minigame) => minigame.name === joinMinigame.minigame.name);
    if (minigame && joinMinigame) {
      const player = this.omegga.getPlayer(joinMinigame.player.name);
      const joinMinigameEvent = {
        player: player,
        minigame: {
          name: joinMinigame.minigame.name,
          ruleset: minigame.ruleset,
          index: minigame.index
        }
      }
      this.subscribers.forEach(subscriber => {
        subscriber.emitPlugin('joinminigame', joinMinigameEvent);
      })

      this.onMinigameLeave(player, joinMinigameEvent);
    }

  }

  onMinigameLeave = async (player, joinMinigameEvent) => {
    if (player) {
      const playerState = this.playerStateCache.get(player.state);
      if (playerState && playerState.minigame) {
        const newMinigame = joinMinigameEvent?.minigame;
        this.subscribers.forEach(subscriber => {
          subscriber.emitPlugin('leaveminigame', {
            player: player,
            minigame: playerState.minigame,
            newMinigame
          });
        })
      }
      if (joinMinigameEvent) {
        this.playerStateCache.set(player.state, { playerState, ...joinMinigameEvent });
      } else {
        // player left the game
        this.playerStateCache.delete(player.state);
      }
    }
  }

  minigameCheck = async () => {
    if (this.subscribers.length > 0) {
      const minigameRounds = await this.getMinigameRounds();

      const nextRound = [];
      const endedRound = [];
      const newMinigames = []

      minigameRounds.forEach((minigame) => {
        const { ruleset, name, roundEnded } = minigame;
        const minigameRoundCache = this.minigameCache.get(ruleset);
        if (minigameRoundCache) {
          if (minigameRoundCache.roundEnded && !roundEnded) {
            nextRound.push(minigame);
            this.minigameCache.set(ruleset, minigame);
          } else if (!minigameRoundCache.roundEnded && roundEnded) {
            endedRound.push(minigame);
            this.minigameCache.set(ruleset, minigame);
          }
          if (minigameRoundCache.name != name) {
            this.minigameCache.set(ruleset, minigame);
          }
        } else {
          this.minigameCache.set(ruleset, minigame);
          newMinigames.push(minigame);
        }
      })

      nextRound.forEach(minigame => {
        this.subscribers.forEach(subscriber => {
          subscriber.emitPlugin('roundchange', minigame);
        })
      })
      endedRound.forEach(minigame => {
        this.subscribers.forEach(subscriber => {
          subscriber.emitPlugin('roundend', minigame);
        })
      })

      for (const minigame of newMinigames) {
        const minigameOwnerInMinigame = await this.getMinigameOwnerInMinigame(minigame.ruleset);
        if (minigameOwnerInMinigame && this.playerStateCache.get(minigameOwnerInMinigame)?.minigame?.ruleset != minigame.ruleset) {
          this.onMinigameJoin({
            player: this.omegga.getPlayer(minigameOwnerInMinigame),
            minigame
          });
        }
      }
    }
  }

  async getMinigameRounds() {
    const ruleNameRegExp = /^(?<index>\d+)\) BP_Ruleset_C (.+):PersistentLevel.(?<ruleset>BP_Ruleset_C_\d+)\.RulesetName = (?<name>.*)$/;
    const roundEndedRegExp = /^(?<index>\d+)\) BP_Ruleset_C (.+):PersistentLevel.(?<ruleset>BP_Ruleset_C_\d+)\.bInSession = (?<inSession>(True|False))$/;

    const [rulesets, roundEndeds] = await Promise.all([
      this.omegga.watchLogChunk<RegExpMatchArray>(
        'GetAll BP_Ruleset_C RulesetName',
        ruleNameRegExp,
        {
          first: 'index',
          timeoutDelay: 5000,
          afterMatchDelay: 100
        }
      ),
      this.omegga.watchLogChunk<RegExpMatchArray>(
        'GetAll BP_Ruleset_C bInSession',
        roundEndedRegExp,
        {
          first: 'index',
          timeoutDelay: 5000,
          afterMatchDelay: 100
        }
      ),
    ]);

    return rulesets.map(ruleset => ({
      index: ruleset.groups?.index,
      ruleset: ruleset.groups?.ruleset,
      name: ruleset.groups?.name,
      roundEnded: roundEndeds.find(roundEnd => roundEnd.groups?.ruleset === ruleset.groups?.ruleset)?.groups?.inSession === "False"
    }));
  }


  // :: [2022.04.28-22.59.49:083][797]0) BP_Ruleset_C /Game/Maps/Plate/Plate.Plate:PersistentLevel.BP_Ruleset_C_2147482529.RulesetType = Global
  // :: [2022.04.28-22.59.49:084][797]1) BP_Ruleset_C /Game/Maps/Plate/Plate.Plate:PersistentLevel.BP_Ruleset_C_2147482212.RulesetType = Minigame
  // :: [2022.04.28-22.59.49:084][797]2) BP_Ruleset_C /Game/Maps/Plate/Plate.Plate:PersistentLevel.BP_Ruleset_C_2147482412.RulesetType = DefaultMinigame
  // :: [2022.04.28-22.59.49:084][797]3) BP_Ruleset_C /Game/Maps/Plate/Plate.Plate:PersistentLevel.BP_Ruleset_C_2147482286.RulesetType = PersistentMinigame
  getDefaultMinigame = async () => {
    const minigameTypeRegExp = /^(?<index>\d+)\) BP_Ruleset_C (.+):PersistentLevel.(?<ruleset>BP_Ruleset_C_\d+)\.RulesetType = (?<type>(Global|Minigame|DefaultMinigame|PersistentMinigame))$/;

    const [minigameTypesMatch] = await Promise.all([
      this.omegga.watchLogChunk<RegExpMatchArray>(
        'GetAll BP_Ruleset_C RulesetType',
        minigameTypeRegExp,
        {
          first: 'index',
          timeoutDelay: 5000,
          afterMatchDelay: 100
        }
      )
    ]);

    const minigameTypes = minigameTypesMatch.map((minigameType) => ({
      ruleset: minigameType?.groups?.ruleset,
      type: minigameType?.groups?.type,
    }))

    const defaultMinigame = minigameTypes.find((minigameType) => minigameType.type === MinigameTypes.Default) || minigameTypes.find((minigameType) => minigameType.type === MinigameTypes.Global)

    return defaultMinigame;
  }


  // :: [2022.04.29-01.15.31:158][921]0) BP_Ruleset_C /Game/Maps/Plate/Plate.Plate:PersistentLevel.BP_Ruleset_C_2147482529.OwnerStateCached = None
  // :: [2022.04.29-01.15.31:158][921]1) BP_Ruleset_C /Game/Maps/Plate/Plate.Plate:PersistentLevel.BP_Ruleset_C_2147482412.OwnerStateCached = BP_PlayerState_C'/Game/Maps/Plate/Plate.Plate:PersistentLevel.BP_PlayerState_C_2147482521'
  getMinigameOwnerInMinigame = async (ruleset) => {
    const ownerStateRegEx = /(?<index>\d+)\) BP_Ruleset_C .+?PersistentLevel\.(?<ruleset>BP_Ruleset_C_\d+)\.OwnerStateCached = (?:None|BP_PlayerState_C'.+?:PersistentLevel.(?<state>BP_PlayerState_C_\d+)')?$/;
    const ruleMembersRegExp =
      /^(?<index>\d+)\) BP_Ruleset_C (.+):PersistentLevel.(?<ruleset>BP_Ruleset_C_\d+)\.MemberStates =$/;
    const playerStateRegExp =
      /^\t(?<index>\d+): BP_PlayerState_C'(.+):PersistentLevel\.(?<state>BP_PlayerState_C_\d+)'$/;

    const [ownerStateMatch, ruleMembers] = await Promise.all([
      this.omegga.watchLogChunk<RegExpMatchArray>(
        `GetAll BP_Ruleset_C OwnerStateCached Name=${ruleset}`,
        ownerStateRegEx,
        {
          first: 'index',
          timeoutDelay: 5000,
          afterMatchDelay: 100
        }
      ),
      this.omegga.watchLogArray<
        { index: string; ruleset: string },
        { index: string; state: string }
      >(
        `GetAll BP_Ruleset_C MemberStates Name=${ruleset}`,
        ruleMembersRegExp,
        playerStateRegExp
      ),

    ]);

    const ownerMinigame = ownerStateMatch.find((ownerState) => ownerState?.groups?.ruleset === ruleset);
    const ownerInMinigame = ruleMembers
          .find(m => m.item.ruleset === ruleset)
          ?.members
          ?.find(m => m.state === ownerMinigame?.groups?.state)
    return Boolean(ownerInMinigame) ? ownerInMinigame.state : null;
  }

  leaderboardCheck = async () => {
    const leaderboardInfo = await this.getLeaderboardInfo();

    leaderboardInfo.forEach(({state, leaderboard}) => {
      const playerState = this.playerStateCache.get(state);

      if (playerState && leaderboard) {
        if (!playerState.leaderboard) {
          this.playerStateCache.set(state, { ...playerState, leaderboard })
          return;
        }

        const changeIndex = [];
        for (const i in leaderboard) {
          if (playerState.leaderboard[i] === leaderboard[i]) {
            changeIndex[i] = 0;
          } else {
            changeIndex[i] = 1;
          }
        }

        if(!changeIndex.every(val => val === 0)) {
          const newPlayerState = { ...playerState, leaderboard }
          const oldLeaderboard = playerState.leaderboard || [0,0,0];
          const event = { ...newPlayerState, oldLeaderboard }
          this.subscribers.forEach(subscriber => {
            subscriber.emitPlugin('leaderboardchange', event);
          })

          const changeEventNames = ['score','kill','death']
          changeIndex.forEach((change, i) => {
            if(change) {
              if (leaderboard[i] > oldLeaderboard[i]) {
                this.subscribers.forEach(subscriber => {
                  subscriber.emitPlugin(changeEventNames[i], event);
                })
              }
            }
          })

          this.playerStateCache.set(state, newPlayerState)
        }
      }
    })
  }

  getLeaderboardInfo = async () => {
    const playerStateLeaderboardRegExp =
      /^(?<index>\d+)\) BP_PlayerState_C (.+):PersistentLevel.(?<state>BP_PlayerState_C_\d+)\.LeaderboardData =$/;
    const leaderboardRegExp =
      /^\t(?<index>\d+): (?<column>\d+)$/;


    let [leaderboards] = await Promise.all([
      this.omegga.watchLogArray<
        { index: string; ruleset: string },
        { index: string; state: string }
      >(
        'GetAll BP_PlayerState_C LeaderboardData',
        playerStateLeaderboardRegExp,
        leaderboardRegExp
      )
    ]);

    const leaderboardData = leaderboards.map((leaderboard) => ({
      state: leaderboard?.item?.state,
      leaderboard: leaderboard?.members?.map(member => +member.column)
    }))

    return leaderboardData
  }

  async pluginEvent(event: string, from: string, ...args: any[]) {
    if (event === 'subscribe') {
      this.subscribe(from);
    }
    if (event === 'unsubscribe') {
      this.unsubscribe(from);
    }
  }
}