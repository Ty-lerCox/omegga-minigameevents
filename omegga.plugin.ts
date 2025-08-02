import OmeggaPlugin, { OL, PS, PC, PluginInterop } from './omegga';
import joinMinigameMatcher from './matchers/joinMinigame';
import { JoinMinigame, MinigameTypes } from './types';

type Config = {
  /** Polling interval in ms (defaults applied if unset) */
  minigameCheckInterval?: number;
  leaderboardCheckInterval?: number;
};
type Storage = {
  subscriberNames: string[];
  minigameCache: Record<string, unknown>;
  playerStateCache: Record<string, unknown>;
};

export default class Plugin implements OmeggaPlugin<Config, Storage> {
  /* ------------------------------------------------------------  fields */
  omegga: OL;
  config: PC<Config>;
  store: PS<Storage>;

  /** other plugins that subscribed */
  subscribers: PluginInterop[] = [];

  private minigameTimer?: NodeJS.Timeout;
  private leaderboardTimer?: NodeJS.Timeout;

  /** one‑at‑a‑time guards */
  private isMinigameCheckRunning = false;
  private isLeaderboardCheckRunning = false;

  /** caches */
  private minigameCache = new Map<string, any>();
  private playerStateCache = new Map<
    string,
    { ruleset: string; leaderboard?: number[]; lastSeen: number }
  >();
  /** rate‑limit duplicate checkpoint lines */
  public joinTracker: Record<string, number> = {};

  /* ------------------------------------------------------------  ctor */
  constructor(omegga: OL, config: PC<Config>, store: PS<Storage>) {
    this.omegga = omegga;
    this.config = config;
    this.store = store;
  }

  /* ------------------------------------------------------------  life‑cycle */
  async init() {
    /* restore caches if we had a hot reload */
    const rawMg = await this.store.get('minigameCache');
    if (rawMg) this.minigameCache = new Map(Object.entries(rawMg));

    const rawPs = await this.store.get('playerStateCache');
    if (rawPs) this.playerStateCache = new Map(Object.entries(rawPs));

    /* resubscribe previous listeners */
    const subscriberNames = (await this.store.get('subscriberNames')) || [];
    await Promise.all(subscriberNames.map((n) => this.subscribe(n)));

    /* timers */
    const mgInterval = this.config.minigameCheckInterval ?? 1000;
    const lbInterval = this.config.leaderboardCheckInterval ?? 1000;
    this.minigameTimer = setInterval(this.minigameCheck, mgInterval);
    this.leaderboardTimer = setInterval(this.leaderboardCheck, lbInterval);

    /* log matcher */
    const { pattern, callback } = joinMinigameMatcher(this);
    this.omegga.addMatcher(pattern as any, callback as any);

    /* leave + server start hooks */
    this.omegga.on('leave', this.onLeave);
    this.omegga.on('start', () => {
      this.minigameCache.clear();
      this.playerStateCache.clear();
      this.joinTracker = {};
    });
  }

  async stop() {
    if (this.minigameTimer) clearInterval(this.minigameTimer);
    if (this.leaderboardTimer) clearInterval(this.leaderboardTimer);
    this.isMinigameCheckRunning = this.isLeaderboardCheckRunning = false;

    await this.store.set(
      'minigameCache',
      Object.fromEntries(this.minigameCache)
    );
    await this.store.set(
      'playerStateCache',
      Object.fromEntries(this.playerStateCache)
    );
  }

  /* ------------------------------------------------------------  subscribe helpers */
  async subscribe(pluginName: string) {
    if (!this.subscribers.some((s) => s.name === pluginName)) {
      const p = await this.omegga.getPlugin(pluginName);
      if (p?.loaded) this.subscribers.push(p);
      else this.omegga.log(`${pluginName} not loaded – subscription skipped`);
    }
    await this.store.set(
      'subscriberNames',
      this.subscribers.map((s) => s.name)
    );
  }

  async unsubscribe(pluginName: string) {
    this.subscribers = this.subscribers.filter((s) => s.name !== pluginName);
    await this.store.set(
      'subscriberNames',
      this.subscribers.map((s) => s.name)
    );
  }

  /* ------------------------------------------------------------  join / leave */
  onLeave = (playerName) => {
    const p = this.omegga.getPlayer(playerName);
    if (p) this.onMinigameLeave(p, null);
  };

  onMinigameJoin = async (jm: JoinMinigame, retry = 0) => {
    const player = this.omegga.getPlayer(jm.player.name);
    const minigame = [...this.minigameCache.values()].find(
      (m) => m.name === jm.minigame.name
    );
    if (!player || !minigame) {
      if (retry < 20) setTimeout(() => this.onMinigameJoin(jm, retry + 1), 100);
      return;
    }

    const event = {
      player,
      minigame: {
        name: jm.minigame.name,
        ruleset: minigame.ruleset,
        index: minigame.index,
      },
    };

    this.onMinigameLeave(player, event); // auto‑fire leave if changing MG
    this.subscribers.forEach((s) => s.emitPlugin('joinminigame', event));
  };

  onMinigameLeave = async (player, joinEvent) => {
    const ps = this.playerStateCache.get(player.state);
    const mg = ps ? this.minigameCache.get(ps.ruleset) : undefined;

    if (ps && mg) {
      this.subscribers.forEach((s) =>
        s.emitPlugin('leaveminigame', {
          player,
          minigame: mg,
          newMinigame: joinEvent?.minigame,
        })
      );
    }

    if (joinEvent)
      this.playerStateCache.set(player.state, {
        ruleset: joinEvent.minigame.ruleset,
        lastSeen: Date.now(),
      });
    else this.playerStateCache.delete(player.state);
  };

  /* ------------------------------------------------------------  polling loops */
  minigameCheck = async () => {
    if (this.isMinigameCheckRunning || this.subscribers.length === 0) return;
    this.isMinigameCheckRunning = true;
    try {
      const rounds = await this.getMinigameRounds();
      const nextRound: any[] = [];
      const endedRound: any[] = [];

      rounds.forEach((mg) => {
        const cached = this.minigameCache.get(mg.ruleset);
        if (cached) {
          if (cached.roundEnded && !mg.roundEnded) nextRound.push(mg);
          else if (!cached.roundEnded && mg.roundEnded) endedRound.push(mg);
          if (cached.name !== mg.name || cached.index !== mg.index)
            this.minigameCache.set(mg.ruleset, mg);
        } else this.minigameCache.set(mg.ruleset, mg);
      });

      nextRound.forEach((m) =>
        this.subscribers.forEach((s) => s.emitPlugin('roundchange', m))
      );
      endedRound.forEach((m) =>
        this.subscribers.forEach((s) => s.emitPlugin('roundend', m))
      );

      /* occasionally prune minigameCache (GLOBAL always kept) */
      if (Math.random() < 0.02) {
        const cutoff = Date.now() - 60 * 60 * 1000;
        for (const [k, v] of this.minigameCache)
          if (v.lastSeen && v.lastSeen < cutoff && v.name !== 'GLOBAL')
            this.minigameCache.delete(k);
      }
    } finally {
      this.isMinigameCheckRunning = false;
    }
  };

  leaderboardCheck = async () => {
    if (
      this.isLeaderboardCheckRunning ||
      this.subscribers.length === 0 // nobody cares – skip
    )
      return;
    this.isLeaderboardCheckRunning = true;
    try {
      const info = await this.getLeaderboardInfo();
      info.forEach(({ state, leaderboard }) => {
        const ps = this.playerStateCache.get(state);
        if (!ps) return;
        const mg = this.minigameCache.get(ps.ruleset);
        if (!mg) return;

        const oldLb = ps.leaderboard || [0, 0, 0];
        const changed = leaderboard.map((v, i) => v !== oldLb[i]);
        if (!changed.some(Boolean)) return;

        const event = {
          player: this.omegga.getPlayer(state),
          leaderboard,
          oldLeaderboard: oldLb,
          minigame: mg,
        };
        this.subscribers.forEach((s) => s.emitPlugin('leaderboardchange', event));

        ['score', 'kill', 'death'].forEach((name, i) => {
          if (changed[i] && leaderboard[i] > oldLb[i])
            this.subscribers.forEach((s) => s.emitPlugin(name, event));
        });

        this.playerStateCache.set(state, {
          ...ps,
          leaderboard,
          lastSeen: Date.now(),
        });
      });

      /* prune stale player states */
      if (Math.random() < 0.02) {
        const cutoff = Date.now() - 5 * 60 * 1000;
        for (const [state, entry] of this.playerStateCache)
          if (entry.lastSeen < cutoff) this.playerStateCache.delete(state);
      }
    } finally {
      this.isLeaderboardCheckRunning = false;
    }
  };

  /* ------------------------------------------------------------  helpers (mostly unchanged) */
  async getMinigameRounds() {
    const ruleNameRegExp =
      /^(?<index>\d+)\) BP_Ruleset_C (.+):PersistentLevel\.(?<ruleset>BP_Ruleset_C_\d+)\.RulesetName = (?<name>.*)$/;
    const roundEndedRegExp =
      /^(?<index>\d+)\) BP_Ruleset_C (.+):PersistentLevel\.(?<ruleset>BP_Ruleset_C_\d+)\.bInSession = (?<inSession>(True|False))$/;

    const [rulesets, roundEndeds] = await Promise.all([
      this.omegga.watchLogChunk('GetAll BP_Ruleset_C RulesetName', ruleNameRegExp, {
        first: 'index',
        timeoutDelay: 5000,
        afterMatchDelay: 100,
      }),
      this.omegga.watchLogChunk('GetAll BP_Ruleset_C bInSession', roundEndedRegExp, {
        first: 'index',
        timeoutDelay: 5000,
        afterMatchDelay: 100,
      }),
    ]);

    const sorted = rulesets.sort((a, b) =>
      (b.groups?.ruleset ?? '').localeCompare(a.groups?.ruleset ?? '')
    );
    const globalIdx = rulesets.findIndex((r) => r.groups?.name === 'GLOBAL');

    return sorted.map((rs, idx) => {
      let index = idx;
      if (globalIdx >= 0) {
        if (index > globalIdx) index -= 1;
        else if (index === globalIdx) index = -1;
      }
      return {
        index,
        ruleset: rs.groups?.ruleset,
        name: rs.groups?.name,
        roundEnded:
          roundEndeds.find((re) => re.groups?.ruleset === rs.groups?.ruleset)
            ?.groups?.inSession === 'False',
      };
    });
  }

  /* ... getDefaultMinigame() and getMinigameOwnerInMinigame() left unchanged ... */

  getLeaderboardInfo = async () => {
    const psReg =
      /^(?<index>\d+)\) BP_PlayerState_C (.+):PersistentLevel\.(?<state>BP_PlayerState_C_\d+)\.LeaderboardData =$/;
    const lbReg = /^\t(?<index>\d+): (?<column>-?\d+)$/;

    const [rows] = await Promise.all([
      this.omegga.watchLogArray(
        'GetAll BP_PlayerState_C LeaderboardData',
        psReg,
        lbReg
      ),
    ]);

    return rows.map((row) => ({
      state: row.item.state,
      leaderboard: row.members.map((m) => +m.column),
    }));
  };

  /* ------------------------------------------------------------  plugin‑to‑plugin API */
  async pluginEvent(event: string, from: string) {
    if (event === 'subscribe') await this.subscribe(from);
    if (event === 'unsubscribe') await this.unsubscribe(from);
  }
}
