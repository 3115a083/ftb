import { METRICS } from './rules.js';
import { db } from './db.js';

export async function assignGroups(groupCount, demo = false, client = db) {
  const { rows } = await client.query(
    'SELECT id FROM teams WHERE is_demo=$1 AND NOT disqualified ORDER BY random()',
    [demo],
  );
  const n = Math.max(1, Math.min(+groupCount || 1, 26));
  const names = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
  for (let i = 0; i < rows.length; i += 1) {
    await client.query(
      'UPDATE teams SET group_name=$1,rank_override=NULL,version=version+1 WHERE id=$2',
      [names[i % n], rows[i].id],
    );
  }
  return names;
}

function roundRobin(teamIds) {
  const ids = [...teamIds];
  if (ids.length % 2) ids.push(null);
  const rounds = [];
  for (let r = 0; r < ids.length - 1; r += 1) {
    const games = [];
    for (let i = 0; i < ids.length / 2; i += 1) {
      const a = ids[i];
      const b = ids[ids.length - 1 - i];
      if (a && b) games.push([a, b]);
    }
    rounds.push(games);
    ids.splice(1, 0, ids.pop());
  }
  return rounds;
}

export async function createGroupGames({ demo = false, client = db } = {}) {
  const existing = Number((await client.query(
    "SELECT count(*)::int n FROM games WHERE is_demo=$1 AND phase='group' AND status<>'cancelled'",
    [demo],
  )).rows[0].n);
  if (existing) throw new Error('group_games_exist');

  const teams = (await client.query(
    'SELECT id,group_name FROM teams WHERE is_demo=$1 AND NOT disqualified AND group_name IS NOT NULL ORDER BY group_name,name',
    [demo],
  )).rows;
  const groups = [...new Set(teams.map((t) => t.group_name))].sort();
  let created = 0;

  for (const group of groups) {
    const ids = teams.filter((t) => t.group_name === group).map((t) => t.id);
    const rounds = roundRobin(ids);
    for (let round = 0; round < rounds.length; round += 1) {
      for (let slot = 0; slot < rounds[round].length; slot += 1) {
        const [home, away] = rounds[round][slot];
        await client.query(
          "INSERT INTO games(group_name,phase,round_label,round_no,slot_no,home_team_id,away_team_id,is_demo) VALUES($1,'group',$2,$3,$4,$5,$6,$7)",
          [group, `Gruppenrunde ${round + 1}`, round + 1, slot + 1, home, away, demo],
        );
        created += 1;
      }
    }
  }
  return { groups: groups.length, games: created };
}

export function rankGroup(teams, games, tiebreakers = []) {
  const rows = teams.map((t) => {
    const own = games.filter((g) => g.home_team_id === t.id || g.away_team_id === t.id);
    const wins = own.filter((g) => g.winner_team_id === t.id).length;
    return { ...t, played: own.length, wins, losses: own.length - wins, tie_unresolved: false };
  });

  const byWins = new Map();
  for (const row of rows) {
    if (!byWins.has(row.wins)) byWins.set(row.wins, []);
    byWins.get(row.wins).push(row);
  }

  const ranked = [];
  for (const wins of [...byWins.keys()].sort((a, b) => b - a)) {
    const tied = byWins.get(wins);
    if (tied.length === 1) {
      ranked.push(tied[0]);
      continue;
    }

    const overrides = tied.filter((t) => Number.isInteger(t.rank_override));
    if (overrides.length === tied.length && new Set(overrides.map((t) => t.rank_override)).size === tied.length) {
      ranked.push(...tied.sort((a, b) => a.rank_override - b.rank_override));
      continue;
    }

    if (tied.length === 2) {
      const [a, b] = tied;
      const direct = games.find((g) => (
        (g.home_team_id === a.id && g.away_team_id === b.id)
        || (g.home_team_id === b.id && g.away_team_id === a.id)
      ) && g.winner_team_id);
      if (direct) {
        ranked.push(direct.winner_team_id === a.id ? a : b, direct.winner_team_id === a.id ? b : a);
        continue;
      }
    }

    const usable=tiebreakers.filter(k=>tied.every(t=>Number.isFinite(t.metrics?.[k])));
    if(usable.length){
      const compare=(a,b)=>{for(const key of usable){const d=(a.metrics[key]-b.metrics[key])*METRICS[key].direction;if(d)return d;}return 0;};
      const ordered=[...tied].sort(compare);
      for(let i=0;i<ordered.length;i++)ordered[i].tie_unresolved=(i>0&&compare(ordered[i-1],ordered[i])===0)||(i+1<ordered.length&&compare(ordered[i],ordered[i+1])===0);
      ranked.push(...ordered);continue;
    }
    for (const row of tied) row.tie_unresolved = true;
    ranked.push(...tied.sort((a, b) => a.name.localeCompare(b.name, 'de')));
  }

  return ranked.map((t, i) => ({ ...t, place: i + 1 }));
}

export async function standings({ demo = false, includeDisqualified = true, client = db } = {}) {
  const teams = (await client.query(
    'SELECT id,name,logo,group_name,disqualified,rank_override FROM teams WHERE is_demo=$1 AND group_name IS NOT NULL ORDER BY group_name,name',
    [demo],
  )).rows;
  const games = (await client.query(
    "SELECT group_name,home_team_id,away_team_id,winner_team_id FROM games WHERE is_demo=$1 AND phase='group' AND status='finished' AND winner_team_id IS NOT NULL",
    [demo],
  )).rows;

  const config=(await client.query('SELECT metrics,tiebreakers FROM event_control WHERE id=1')).rows[0]||{metrics:[],tiebreakers:[]};
  const metrics=(await client.query(`SELECT r.team_id,e.metric,CASE WHEN e.metric='empty_round' THEN avg(e.amount) ELSE sum(e.amount) END::float value
    FROM metric_events e JOIN match_roster r ON r.id=e.subject_id JOIN match_ops m ON m.id=e.match_id
    WHERE m.status='finished' AND e.undone_by IS NULL AND r.team_id IS NOT NULL GROUP BY r.team_id,e.metric`)).rows;
  for(const t of teams)t.metrics=Object.fromEntries(config.metrics.map(k=>[k,metrics.find(x=>x.team_id===t.id&&x.metric===k)?.value??null]));
  return [...new Set(teams.map((t) => t.group_name))].sort().map((group) => {
    const groupTeams = teams.filter((t) => t.group_name === group);
    const active = groupTeams.filter((t) => !t.disqualified);
    const ranked = rankGroup(active, games.filter((g) => g.group_name === group), config.tiebreakers);
    const dq = groupTeams.filter((t) => t.disqualified).map((t) => ({
      ...t,
      played: games.filter((g) => g.group_name === group && (g.home_team_id === t.id || g.away_team_id === t.id)).length,
      wins: 0,
      losses: 0,
      place: null,
      tie_unresolved: false,
    }));
    return { group, teams: includeDisqualified ? [...ranked, ...dq] : ranked };
  });
}

export async function setTieOrder(group, orderedTeamIds, client = db) {
  const ids = orderedTeamIds.map(Number);
  const current = (await client.query(
    'SELECT id FROM teams WHERE group_name=$1 AND NOT disqualified AND NOT is_demo',
    [group],
  )).rows.map((r) => r.id);
  if (ids.length !== current.length || ids.some((id) => !current.includes(id)) || new Set(ids).size !== ids.length) {
    throw new Error('invalid_tie_order');
  }
  await client.query('UPDATE teams SET rank_override=NULL WHERE group_name=$1 AND NOT is_demo', [group]);
  for (let i = 0; i < ids.length; i += 1) {
    await client.query('UPDATE teams SET rank_override=$1,version=version+1 WHERE id=$2', [i + 1, ids[i]]);
  }
}

export function recommendKnockout(teamCount) {
  const candidates = [2, 4, 8, 16, 32, 64].filter((n) => n <= teamCount);
  if (!candidates.length) return 0;
  return candidates.reduce(
    (best, n) => (Math.abs(n / teamCount - 0.52) < Math.abs(best / teamCount - 0.52) ? n : best),
    candidates[0],
  );
}

export async function qualificationPlan(client = db) {
  const tables = (await standings({ includeDisqualified: false, client })).filter(g=>g.teams.length);
  const total = tables.reduce((n, g) => n + g.teams.length, 0);
  const size = recommendKnockout(total);
  const unresolved = tables.flatMap((g) => {
    const tied = g.teams.filter((t) => t.tie_unresolved);
    return tied.length ? [{ group: g.group, teams: tied }] : [];
  });
  if (!size) return { size: 0, tables, qualified: [], unresolved };
  if (unresolved.length) return { size, tables, qualified: [], unresolved };

  const per = Math.floor(size / tables.length);
  const qualified = [];
  const pool = [];
  for (const g of tables) {
    qualified.push(...g.teams.slice(0, per).map((t) => ({ ...t, source: `${g.group}${t.place}` })));
    pool.push(...g.teams.slice(per).map((t) => ({ ...t, source: `${g.group}${t.place}` })));
  }
  pool.sort((a, b) => a.place - b.place || b.wins - a.wins || a.losses - b.losses || a.name.localeCompare(b.name, 'de'));
  qualified.push(...pool.slice(0, size - qualified.length));
  return { size, tables, qualified, unresolved };
}

function roundLabel(teamCount) {
  if (teamCount === 2) return 'Finale';
  if (teamCount === 4) return 'Halbfinale';
  if (teamCount === 8) return 'Viertelfinale';
  if (teamCount === 16) return 'Achtelfinale';
  return `Runde der ${teamCount}`;
}

async function insertKnockoutRound(client, winners, roundNo, finalMode) {
  const label = roundLabel(winners.length);
  for (let i = 0; i < winners.length; i += 2) {
    const home = winners[i];
    const away = winners[i + 1];
    const isFinal = winners.length === 2;
    await client.query(
      "INSERT INTO games(phase,round_label,round_no,slot_no,series_key,series_game,home_team_id,away_team_id) VALUES('knockout',$1,$2,$3,$4,$5,$6,$7)",
      [label, roundNo, (i / 2) + 1, isFinal && finalMode === 'bo3' ? 'final' : null, isFinal && finalMode === 'bo3' ? 1 : null, home, away],
    );
  }
}

export async function createKnockout(finalMode = 'single', client = null) {
  const plan = await qualificationPlan(client || db);
  if (plan.size < 2) throw new Error('not_enough_teams');
  if (plan.unresolved.length) throw new Error('unresolved_ties');
  if (plan.qualified.length !== plan.size) throw new Error('not_enough_teams');

  const c = client || await db.connect();
  try {
    if (!client) await c.query('BEGIN');

    const seeds = [...plan.qualified];
    const ordered = [];
    while (seeds.length) {
      const a = seeds.shift();
      let idx = seeds.findIndex((x) => x.group_name !== a.group_name);
      if (idx < 0) idx = seeds.length - 1;
      const b = seeds.splice(idx, 1)[0];
      ordered.push(a.id, b.id);
    }
    await insertKnockoutRound(c, ordered, 1, finalMode);
    await c.query(
      'UPDATE settings SET final_mode=$1,knockout_size=$2,tournament_finished=false,winner_team_id=NULL,version=version+1 WHERE id=1',
      [finalMode, plan.size],
    );
    if (!client) await c.query('COMMIT');
    return plan;
  } catch (e) {
    if (!client) await c.query('ROLLBACK');
    throw e;
  } finally {
    if (!client) c.release();
  }
}

export async function advanceKnockout(gameId, client = null) {
  const c = client || await db.connect();
  try {
    if (!client) await c.query('BEGIN');
    const game = (await c.query('SELECT * FROM games WHERE id=$1 FOR UPDATE', [gameId])).rows[0];
    if (!game || game.phase !== 'knockout' || game.status !== 'finished' || !game.winner_team_id) {
      if (!client) await c.query('COMMIT');
      return { advanced: false };
    }
    const settings = (await c.query('SELECT final_mode FROM settings WHERE id=1 FOR UPDATE')).rows[0];

    if (game.series_key === 'final') {
      const wins = (await c.query(
        "SELECT winner_team_id,count(*)::int n FROM games WHERE series_key='final' AND status<>'cancelled' AND NOT is_demo AND status='finished' GROUP BY winner_team_id ORDER BY n DESC",
      )).rows;
      if (wins[0]?.n >= 2) {
        await c.query(
          'UPDATE settings SET winner_team_id=$1,tournament_finished=true,version=version+1 WHERE id=1',
          [wins[0].winner_team_id],
        );
        if (!client) await c.query('COMMIT');
        return { advanced: true, finished: true, winnerTeamId: wins[0].winner_team_id };
      }
      const count = Number((await c.query("SELECT count(*)::int n FROM games WHERE series_key='final' AND status<>'cancelled' AND NOT is_demo")).rows[0].n);
      if (count < 3) {
        await c.query(
          "INSERT INTO games(phase,round_label,round_no,slot_no,series_key,series_game,home_team_id,away_team_id) VALUES('knockout','Finale',$1,1,'final',$2,$3,$4)",
          [game.round_no, count + 1, game.home_team_id, game.away_team_id],
        );
      }
      if (!client) await c.query('COMMIT');
      return { advanced: true, finished: false };
    }

    if (game.round_label === 'Finale') {
      await c.query(
        'UPDATE settings SET winner_team_id=$1,tournament_finished=true,version=version+1 WHERE id=1',
        [game.winner_team_id],
      );
      if (!client) await c.query('COMMIT');
      return { advanced: true, finished: true, winnerTeamId: game.winner_team_id };
    }

    const current = (await c.query(
      "SELECT id,slot_no,winner_team_id,status FROM games WHERE phase='knockout' AND status<>'cancelled' AND NOT is_demo AND round_no=$1 AND series_key IS NULL ORDER BY slot_no,id FOR UPDATE",
      [game.round_no],
    )).rows;
    if (current.some((g) => g.status !== 'finished' || !g.winner_team_id)) {
      if (!client) await c.query('COMMIT');
      return { advanced: false };
    }

    const nextExists = Number((await c.query(
      "SELECT count(*)::int n FROM games WHERE phase='knockout' AND status<>'cancelled' AND NOT is_demo AND round_no=$1",
      [game.round_no + 1],
    )).rows[0].n);
    if (!nextExists) {
      await insertKnockoutRound(c, current.map((g) => g.winner_team_id), game.round_no + 1, settings.final_mode);
    }
    if (!client) await c.query('COMMIT');
    return { advanced: !nextExists, finished: false };
  } catch (e) {
    if (!client) await c.query('ROLLBACK');
    throw e;
  } finally {
    if (!client) c.release();
  }
}

export async function seedDemo(client = null) {
  const c = client || await db.connect();
  try {
    if (!client) await c.query('BEGIN');
    await c.query('DELETE FROM games WHERE is_demo');
    await c.query('DELETE FROM teams WHERE is_demo');
    const names = ['Becherblitze','Flaschenfreunde','Zielwasser','Wurfwunder','Kronkorken Crew','Durstlöscher','Dosenjäger','Treffertruppe'];
    const ids = [];
    for (let i = 0; i < 8; i += 1) {
      const r = await c.query('INSERT INTO teams(name,group_name,is_demo) VALUES($1,$2,true) RETURNING id', [names[i], i < 4 ? 'A' : 'B']);
      ids.push(r.rows[0].id);
    }
    for (const [a,b,g,w] of [[0,1,'A',0],[2,3,'A',3],[0,2,'A',2],[1,3,'A',1],[4,5,'B',4],[6,7,'B',7],[4,6,'B',4],[5,7,'B',7]]) {
      await c.query(
        "INSERT INTO games(group_name,phase,home_team_id,away_team_id,winner_team_id,status,is_demo) VALUES($1,'group',$2,$3,$4,'finished',true)",
        [g, ids[a], ids[b], ids[w]],
      );
    }
    if (!client) await c.query('COMMIT');
  } catch (e) {
    if (!client) await c.query('ROLLBACK');
    throw e;
  } finally {
    if (!client) c.release();
  }
}

export async function clearDemo(client = db) {
  await client.query('DELETE FROM games WHERE is_demo');
  await client.query('DELETE FROM teams WHERE is_demo');
}
